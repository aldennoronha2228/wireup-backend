import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getAppConfig, loadEnvironment } from "@wireup/config";
import { SimulatorRequestSchema } from "@wireup/schemas";
import type { ApiResponse, SimulatorResponse, StorageProject } from "@wireup/types";
import {
  createCommonMiddleware,
  createLogger,
  createMetricsCollector,
  getRuntimeConfig,
  registerGracefulShutdown,
  registerHealthRoutes,
  registerMetricsRoute,
  ServiceClient,
} from "@wireup/utils";
import { runVelxioSimulation } from "./velxio.js";
import { buildVelxioAssets } from "./velxio-adapter.js";

loadEnvironment();
const serviceName = "simulator";
const runtimeConfig = getRuntimeConfig(serviceName);
const logger = createLogger(serviceName);
const metrics = createMetricsCollector();
const appConfig = getAppConfig();

const app = new Hono();

app.use("*", cors());
app.use("*", ...createCommonMiddleware(runtimeConfig, logger, metrics));

app.post("/api/simulator/run", async (c) => {
  const body = await c.req.json();
  const parsed = SimulatorRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid simulator request",
          details: parsed.error.flatten(),
        },
      } satisfies ApiResponse<SimulatorResponse>,
      400,
    );
  }

  const storageClient = new ServiceClient({
    baseUrl: process.env.STORAGE_URL || "http://localhost:3007",
  });

  if (!parsed.data.projectId) {
    return c.json(
      {
        success: false,
        error: {
          code: "PROJECT_REQUIRED",
          message: "projectId is required to run Velxio simulations",
        },
      } satisfies ApiResponse<SimulatorResponse>,
      400,
    );
  }

  try {
    const project = await storageClient.get<StorageProject>(
      `/api/storage/projects/${parsed.data.projectId}`,
    );

    if (!project.generatorOutput) {
      return c.json(
        {
          success: false,
          error: {
            code: "MISSING_GENERATOR_OUTPUT",
            message: "Generator output not found for project",
          },
        } satisfies ApiResponse<SimulatorResponse>,
        400,
      );
    }

    if (!project.validatorOutput || !project.validatorOutput.isValid) {
      return c.json(
        {
          success: false,
          error: {
            code: "PROJECT_NOT_VALIDATED",
            message: "Project must pass validation before simulation",
          },
        } satisfies ApiResponse<SimulatorResponse>,
        400,
      );
    }

    const assets = await buildVelxioAssets(project.generatorOutput);

    const response: SimulatorResponse = await runVelxioSimulation(
      {
        baseUrl: process.env.VELXIO_BASE_URL || "http://localhost:8001",
        compileUrl:
          process.env.VELXIO_COMPILE_URL ||
          "http://localhost:8001/api/compile",
        simulationWindowMs: Number(process.env.VELXIO_SIM_WINDOW_MS) || 3000,
      },
      project.generatorOutput,
      assets,
    );

    return c.json({ success: true, data: response } satisfies ApiResponse<SimulatorResponse>);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          code: "SIMULATION_FAILED",
          message: error instanceof Error ? error.message : "Simulation failed",
        },
      } satisfies ApiResponse<SimulatorResponse>,
      502,
    );
  }
});

registerHealthRoutes(app, serviceName);
registerMetricsRoute(app, metrics, serviceName);

const port = runtimeConfig.port;
logger.info("service_starting", { port, envFile: appConfig.runtime.envFile });

const server = serve({
  fetch: app.fetch,
  port,
});

registerGracefulShutdown(server as any, logger);
