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

orchestrateRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = GatewayRequestSchema.safeParse(body);

  if (!parsed.success) {
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

      await emitProgress(stream, projectId, "searching_knowledge", "Searching knowledge");

      let plan = project.plannerOutput;
      if (needsPlan) {
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

        plan = await plannerClient.post<PlannerResponse>("/api/planner/plan", {
          prompt: parsed.data.prompt,
          ragContext: optimizedContext.context,
          projectId,
          projectState: project,
        });

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
        await emitEvent(stream, {
          type: StreamEventType.GENERATION_START,
          timestamp: new Date(),
          data: { projectId },
          projectId,
        });

        generation = await generatorClient.post<GeneratorResponse>(
          "/api/generator/generate",
          {
            plannerOutput: plan,
            projectId,
          },
        );

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
        await emitEvent(stream, {
          type: StreamEventType.VALIDATION_START,
          timestamp: new Date(),
          data: { projectId },
          projectId,
        });

        validation = await validatorClient.post<ValidatorResponse>(
          "/api/validator/validate",
          {
            generatorOutput: generation,
            projectId,
          },
        );

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
        await emitEvent(stream, {
          type: StreamEventType.VALIDATION_COMPLETE,
          timestamp: new Date(),
          data: { cached: true, isValid: validation.isValid, errorCount: validation.errors.length },
          projectId,
        });
      }

      if (!validation) {
        throw new Error("Validator output unavailable");
      }

      if (!validation.isValid) {
        await storageClient.put<StorageProject>(`/api/storage/projects/${projectId}`, {
          status: ProjectStatus.ERROR,
        });
        await emitEvent(stream, {
          type: StreamEventType.ERROR,
          timestamp: new Date(),
          data: { message: "Validation failed; simulation skipped" },
          projectId,
        });
        return;
      }

      await emitProgress(stream, projectId, "generating_circuit", "Generating circuit");

      if (needsSimulate) {
        await emitEvent(stream, {
          type: StreamEventType.SIMULATION_START,
          timestamp: new Date(),
          data: { projectId },
          projectId,
        });

        const simulation = await simulatorClient.post<SimulatorResponse>(
          "/api/simulator/run",
          {
            simulationJson: generation.simulationJson,
            projectId,
          },
        );

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
    } catch (error) {
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
    }
  });
});
