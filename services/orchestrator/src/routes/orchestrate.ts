import { Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { GatewayRequestSchema } from "@wireup/schemas";
import { ServiceClient } from "@wireup/utils";
import {
  ProjectStatus,
  StreamEventType,
  type ApiResponse,
  type ContextBuilderResponse,
  type GeneratorResponse,
  type PlannerResponse,
  type RagResponse,
  type SimulatorResponse,
  type StorageProject,
  type StreamEvent,
  type ValidatorResponse,
} from "@wireup/types";
import { randomUUID } from "crypto";

export const orchestrateRoutes = new Hono();

const ragClient = new ServiceClient({
  baseUrl: process.env.RAG_URL || "http://localhost:3002",
});
const contextBuilderClient = new ServiceClient({
  baseUrl: process.env.CONTEXT_BUILDER_URL || "http://localhost:3008",
});
const plannerClient = new ServiceClient({
  baseUrl: process.env.PLANNER_URL || "http://localhost:3003",
});
const generatorClient = new ServiceClient({
  baseUrl: process.env.GENERATOR_URL || "http://localhost:3004",
});
const validatorClient = new ServiceClient({
  baseUrl: process.env.VALIDATOR_URL || "http://localhost:3005",
});
const simulatorClient = new ServiceClient({
  baseUrl: process.env.SIMULATOR_URL || "http://localhost:3006",
});
const storageClient = new ServiceClient({
  baseUrl: process.env.STORAGE_URL || "http://localhost:3007",
});

const emitEvent = async (stream: SSEStreamingApi, event: StreamEvent) => {
  await stream.writeSSE({
    event: event.type,
    data: JSON.stringify(event),
  });
};

const emitProgress = async (
  stream: SSEStreamingApi,
  projectId: string | undefined,
  stage: string,
  message: string,
  details: Record<string, unknown> = {},
) => {
  await emitEvent(stream, {
    type: StreamEventType.PROGRESS,
    timestamp: new Date(),
    data: {
      stage,
      message,
      ...details,
    },
    projectId,
  });
};

const buildProjectName = (prompt: string) => {
  const trimmed = prompt.trim();
  if (!trimmed) return "Untitled project";
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
};

interface PipelineSummary {
  planner: boolean;
  generator: boolean;
  validator: boolean;
  ngspiceCalled: boolean;
  netlistBuilt: boolean;
  simulationRan: boolean;
  ngspiceSkippedReason?: string;
}

const emptyPipelineSummary = (): PipelineSummary => ({
  planner: false,
  generator: false,
  validator: false,
  ngspiceCalled: false,
  netlistBuilt: false,
  simulationRan: false,
});

const mark = (value: boolean) => (value ? "✅" : "❌");

const trace = (
  method: string,
  event: string,
  payload: Record<string, unknown> = {},
) => {
  console.log(
    JSON.stringify({
      service: "orchestrator",
      timestamp: new Date().toISOString(),
      method,
      event,
      ...payload,
    }),
  );
};

const errorPayload = (method: string, error: unknown, payload: unknown) => ({
  service: "orchestrator",
  method,
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
  payload,
});

const printPipelineSummary = (summary: PipelineSummary) => {
  console.log("================ PIPELINE SUMMARY ================");
  console.log(`Planner        ${mark(summary.planner)}`);
  console.log(`Generator      ${mark(summary.generator)}`);
  console.log(`Validator      ${mark(summary.validator)}`);
  console.log(`NGSpice Called ${mark(summary.ngspiceCalled)}`);
  console.log(`Netlist Built  ${mark(summary.netlistBuilt)}`);
  console.log(`Simulation Ran ${mark(summary.simulationRan)}`);
  if (!summary.ngspiceCalled) {
    console.log(`NGSpice skipped reason: ${summary.ngspiceSkippedReason || "Unknown"}`);
  }
  console.log("=================================================");
};

orchestrateRoutes.post("/", async (c) => {
  const requestStartedAt = Date.now();
  const body = await c.req.json();
  trace("POST /api/orchestrate", "request_received", {
    success: true,
    request: body,
  });

  const parsed = GatewayRequestSchema.safeParse(body);

  if (!parsed.success) {
    const summary = emptyPipelineSummary();
    summary.ngspiceSkippedReason =
      "Gateway request failed schema validation before the pipeline started";
    trace("POST /api/orchestrate", "response_returned", {
      success: false,
      durationMs: Date.now() - requestStartedAt,
      error: parsed.error.flatten(),
    });
    printPipelineSummary(summary);
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid orchestration request",
          details: parsed.error.flatten(),
        },
      } satisfies ApiResponse<null>,
      400,
    );
  }

  return streamSSE(c, async (stream) => {
    let projectId = parsed.data.projectId;
    const summary = emptyPipelineSummary();
    const requestPayload = parsed.data;

    try {
      if (!projectId) {
        const createdProject = await storageClient.post<StorageProject>(
          "/api/storage/projects",
          {
            name: buildProjectName(parsed.data.prompt),
            description: parsed.data.prompt,
            ownerId: parsed.data.sessionId,
          },
        );
        projectId = createdProject.id;
      }

      const project = await storageClient.get<StorageProject>(
        `/api/storage/projects/${projectId}`,
      );

      const history = project.conversationHistory ?? [];
      const lastUserMessage = [...history]
        .reverse()
        .find((message) => message.role === "user");
      const promptChanged = lastUserMessage?.content !== parsed.data.prompt;

      if (promptChanged) {
        await storageClient.put<StorageProject>(`/api/storage/projects/${projectId}`, {
          conversationMessage: {
            id: randomUUID(),
            role: "user",
            content: parsed.data.prompt,
            timestamp: new Date(),
          },
        });
      }

      const needsPlan = !project.plannerOutput || promptChanged;
      const needsGenerate = !project.generatorOutput || needsPlan;
      const needsValidate = !project.validatorOutput || needsGenerate;
      const needsSimulate =
        !project.simulationHistory || project.simulationHistory.length === 0 || needsValidate;

      trace("pipeline", "execution_plan", {
        success: true,
        projectId,
        needsPlan,
        needsGenerate,
        needsValidate,
        needsSimulate,
      });

      await emitProgress(stream, projectId, "searching_knowledge", "Searching knowledge");

      let plan = project.plannerOutput;
      if (needsPlan) {
        const startedAt = Date.now();
        trace("Planner", "request_received", {
          success: true,
          projectId,
          prompt: parsed.data.prompt,
        });
        await emitEvent(stream, {
          type: StreamEventType.PLAN_START,
          timestamp: new Date(),
          data: { projectId },
          projectId,
        });

        const ragResponse = await ragClient.post<RagResponse>("/api/rag/query", {
          query: parsed.data.prompt,
          projectId,
        });

        await emitProgress(stream, projectId, "planning", "Planning");

        await emitEvent(stream, {
          type: StreamEventType.PLAN_PROGRESS,
          timestamp: new Date(),
          data: { stage: "rag_complete", totalHits: ragResponse.totalHits },
          projectId,
        });

        const optimizedContext = await contextBuilderClient.post<ContextBuilderResponse>(
          "/api/context-builder/build",
          {
            query: parsed.data.prompt,
            ragResponse,
            projectId,
          },
        );

        try {
          plan = await plannerClient.post<PlannerResponse>("/api/planner/plan", {
            prompt: parsed.data.prompt,
            ragContext: optimizedContext.context,
            projectId,
            projectState: project,
          });
        } catch (error) {
          trace("Planner", "exception", {
            success: false,
            projectId,
            durationMs: Date.now() - startedAt,
            error: errorPayload("Planner", error, {
              prompt: parsed.data.prompt,
              ragContext: optimizedContext.context,
              projectId,
            }),
          });
          console.log(`[Planner] completed in ${Date.now() - startedAt} ms`);
          throw error;
        }
        summary.planner = true;
        trace("Planner", "response_returned", {
          success: true,
          projectId,
          durationMs: Date.now() - startedAt,
          response: plan,
        });
        console.log(`[Planner] completed in ${Date.now() - startedAt} ms`);

        await storageClient.put<StorageProject>(`/api/storage/projects/${projectId}`, {
          status: ProjectStatus.PLANNING,
          plannerOutput: plan,
        });

        await emitEvent(stream, {
          type: StreamEventType.PLAN_COMPLETE,
          timestamp: new Date(),
          data: { hardwarePlatform: plan.hardwarePlatform.type },
          projectId,
        });
      } else {
        summary.planner = Boolean(plan);
        trace("Planner", "response_returned", {
          success: Boolean(plan),
          projectId,
          cached: true,
          reason: "Planner output reused from storage; planner service was not invoked",
          response: plan,
        });
        await emitEvent(stream, {
          type: StreamEventType.PLAN_COMPLETE,
          timestamp: new Date(),
          data: { cached: true, projectId },
          projectId,
        });
      }

      if (!plan) {
        throw new Error("Planner output unavailable");
      }

      await emitProgress(stream, projectId, "generating_firmware", "Generating firmware");

      let generation = project.generatorOutput;
      if (needsGenerate) {
        const startedAt = Date.now();
        trace("Generator", "request_received", {
          success: true,
          projectId,
          request: { plannerOutput: plan, projectId },
        });
        await emitEvent(stream, {
          type: StreamEventType.GENERATION_START,
          timestamp: new Date(),
          data: { projectId },
          projectId,
        });

        try {
          generation = await generatorClient.post<GeneratorResponse>(
            "/api/generator/generate",
            {
              plannerOutput: plan,
              projectId,
            },
          );
        } catch (error) {
          trace("Generator", "exception", {
            success: false,
            projectId,
            durationMs: Date.now() - startedAt,
            error: errorPayload("Generator", error, { plannerOutput: plan, projectId }),
          });
          console.log(`[Generator] completed in ${Date.now() - startedAt} ms`);
          throw error;
        }
        summary.generator = true;
        trace("Generator", "response_returned", {
          success: true,
          projectId,
          durationMs: Date.now() - startedAt,
          response: generation,
        });
        console.log(`[Generator] completed in ${Date.now() - startedAt} ms`);

        await emitProgress(stream, projectId, "generating_components", "Generating components");

        await storageClient.put<StorageProject>(`/api/storage/projects/${projectId}`, {
          status: ProjectStatus.GENERATING,
          generatorOutput: generation,
        });

        await emitEvent(stream, {
          type: StreamEventType.GENERATION_COMPLETE,
          timestamp: new Date(),
          data: { componentCount: generation.componentList.length },
          projectId,
        });
      } else if (generation) {
        summary.generator = true;
        trace("Generator", "response_returned", {
          success: true,
          projectId,
          cached: true,
          reason: "Generator output reused from storage; generator service was not invoked",
          response: generation,
        });
        await emitEvent(stream, {
          type: StreamEventType.GENERATION_COMPLETE,
          timestamp: new Date(),
          data: { cached: true, componentCount: generation.componentList.length },
          projectId,
        });
      }

      if (!generation) {
        throw new Error("Generator output unavailable");
      }

      await emitProgress(stream, projectId, "validating", "Validating");

      let validation = project.validatorOutput;
      if (needsValidate) {
        const startedAt = Date.now();
        trace("Validator", "request_received", {
          success: true,
          projectId,
          request: { generatorOutput: generation, projectId },
        });
        await emitEvent(stream, {
          type: StreamEventType.VALIDATION_START,
          timestamp: new Date(),
          data: { projectId },
          projectId,
        });

        try {
          validation = await validatorClient.post<ValidatorResponse>(
            "/api/validator/validate",
            {
              generatorOutput: generation,
              projectId,
            },
          );
        } catch (error) {
          summary.ngspiceSkippedReason =
            "Validator service call failed before returning; see Validator exception log";
          trace("Validator", "exception", {
            success: false,
            projectId,
            durationMs: Date.now() - startedAt,
            error: errorPayload("Validator", error, { generatorOutput: generation, projectId }),
          });
          console.log(`[Validator] completed in ${Date.now() - startedAt} ms`);
          throw error;
        }
        summary.validator = true;
        summary.ngspiceCalled = true;
        summary.netlistBuilt = true;
        trace("Validator", "response_returned", {
          success: true,
          projectId,
          durationMs: Date.now() - startedAt,
          response: validation,
          ngspiceAssumption:
            "Validator returned successfully after validateElectrical; see validator and ngspice logs for exact NGSpice execution details",
        });
        console.log(`[Validator] completed in ${Date.now() - startedAt} ms`);

        await storageClient.put<StorageProject>(`/api/storage/projects/${projectId}`, {
          status: ProjectStatus.VALIDATING,
          validatorOutput: validation,
        });

        await emitEvent(stream, {
          type: StreamEventType.VALIDATION_COMPLETE,
          timestamp: new Date(),
          data: { isValid: validation.isValid, errorCount: validation.errors.length },
          projectId,
        });
      } else if (validation) {
        summary.validator = true;
        summary.ngspiceSkippedReason =
          "Validator output reused from storage; needsValidate=false, so NGSpice was not invoked for this request";
        trace("Validator", "response_returned", {
          success: true,
          projectId,
          cached: true,
          reason: summary.ngspiceSkippedReason,
          response: validation,
        });
        await emitEvent(stream, {
          type: StreamEventType.VALIDATION_COMPLETE,
          timestamp: new Date(),
          data: { cached: true, isValid: validation.isValid, errorCount: validation.errors.length },
          projectId,
        });
      }

      if (!validation) {
        summary.ngspiceSkippedReason =
          "Validator output unavailable; NGSpice cannot be invoked without generator output validation";
        throw new Error("Validator output unavailable");
      }

      if (!validation.isValid) {
        summary.ngspiceSkippedReason = summary.ngspiceCalled
          ? undefined
          : "Validation failed before NGSpice was invoked";
        await storageClient.put<StorageProject>(`/api/storage/projects/${projectId}`, {
          status: ProjectStatus.ERROR,
        });
        await emitEvent(stream, {
          type: StreamEventType.ERROR,
          timestamp: new Date(),
          data: { message: "Validation failed; simulation skipped" },
          projectId,
        });
        trace("Simulator", "not_invoked", {
          success: false,
          projectId,
          reason: "Validation failed; simulation skipped",
          validation,
        });
        trace("POST /api/orchestrate", "response_returned", {
          success: false,
          durationMs: Date.now() - requestStartedAt,
          reason: "Validation failed; simulation skipped",
        });
        printPipelineSummary(summary);
        return;
      }

      await emitProgress(stream, projectId, "generating_circuit", "Generating circuit");

      if (needsSimulate) {
        const startedAt = Date.now();
        trace("Simulator", "request_received", {
          success: true,
          projectId,
          request: { simulationJson: generation.simulationJson, projectId },
        });
        await emitEvent(stream, {
          type: StreamEventType.SIMULATION_START,
          timestamp: new Date(),
          data: { projectId },
          projectId,
        });

        let simulation: SimulatorResponse;
        try {
          simulation = await simulatorClient.post<SimulatorResponse>(
            "/api/simulator/run",
            {
              simulationJson: generation.simulationJson,
              projectId,
            },
          );
        } catch (error) {
          trace("Simulator", "exception", {
            success: false,
            projectId,
            durationMs: Date.now() - startedAt,
            error: errorPayload("Simulator", error, {
              simulationJson: generation.simulationJson,
              projectId,
            }),
          });
          console.log(`[Simulator] completed in ${Date.now() - startedAt} ms`);
          throw error;
        }
        summary.simulationRan = true;
        trace("Simulator", "response_returned", {
          success: true,
          projectId,
          durationMs: Date.now() - startedAt,
          response: simulation,
        });
        console.log(`[Simulator] completed in ${Date.now() - startedAt} ms`);

        await emitProgress(stream, projectId, "running_simulation", "Running simulation");

        await storageClient.put<StorageProject>(`/api/storage/projects/${projectId}`, {
          status: ProjectStatus.SIMULATING,
          simulationResult: simulation,
        });

        await emitEvent(stream, {
          type: StreamEventType.SIMULATION_COMPLETE,
          timestamp: new Date(),
          data: { status: simulation.status },
          projectId,
        });
      } else {
        summary.simulationRan = Boolean(project.simulationHistory?.length);
        trace("Simulator", "response_returned", {
          success: summary.simulationRan,
          projectId,
          cached: true,
          reason: "Simulation history reused from storage; simulator service was not invoked",
        });
        await emitEvent(stream, {
          type: StreamEventType.SIMULATION_COMPLETE,
          timestamp: new Date(),
          data: { cached: true },
          projectId,
        });
      }

      await emitProgress(stream, projectId, "saving_project", "Saving project");

      await storageClient.put<StorageProject>(`/api/storage/projects/${projectId}`, {
        status: ProjectStatus.COMPLETED,
      });

      await emitProgress(stream, projectId, "done", "Done");
      await stream.writeSSE({ event: "done", data: "[DONE]" });
      trace("POST /api/orchestrate", "response_returned", {
        success: true,
        durationMs: Date.now() - requestStartedAt,
        projectId,
      });
      printPipelineSummary(summary);
    } catch (error) {
      if (!summary.ngspiceCalled && !summary.ngspiceSkippedReason) {
        summary.ngspiceSkippedReason =
          "Pipeline stopped before Validator could invoke NGSpice; see preceding exception log";
      }
      trace("POST /api/orchestrate", "exception", {
        success: false,
        durationMs: Date.now() - requestStartedAt,
        projectId,
        error: errorPayload("POST /api/orchestrate", error, requestPayload),
      });
      await emitEvent(stream, {
        type: StreamEventType.ERROR,
        timestamp: new Date(),
        data: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
        projectId,
      });

      if (projectId) {
        try {
          await storageClient.put<StorageProject>(
            `/api/storage/projects/${projectId}`,
            {
              status: ProjectStatus.ERROR,
            },
          );
        } catch {
          // Ignore storage update errors during failure handling
        }
      }
      printPipelineSummary(summary);
    }
  });
});
