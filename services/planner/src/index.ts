import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getAppConfig, loadEnvironment } from "@wireup/config";
import { PlannerRequestSchema } from "@wireup/schemas";
import type { ApiResponse, PlannerResponse } from "@wireup/types";
import {
  createCommonMiddleware,
  createLogger,
  createMetricsCollector,
  getRuntimeConfig,
  registerGracefulShutdown,
  registerHealthRoutes,
  registerMetricsRoute,
} from "@wireup/utils";
import { buildPlan } from "./planner.js";

loadEnvironment();
const serviceName = "planner";
const runtimeConfig = getRuntimeConfig(serviceName);
const logger = createLogger(serviceName);
const metrics = createMetricsCollector();
const appConfig = getAppConfig();

const app = new Hono();

app.use("*", cors());
app.use("*", ...createCommonMiddleware(runtimeConfig, logger, metrics));

app.post("/api/planner/plan", async (c) => {
  const body = await c.req.json();
  const parsed = PlannerRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid planner request",
          details: parsed.error.flatten(),
        },
      } satisfies ApiResponse<PlannerResponse>,
      400,
    );
  }

  const response: PlannerResponse = buildPlan({
    prompt: parsed.data.prompt,
    ragContext: parsed.data.ragContext,
    projectState: parsed.data.projectState,
  });

  return c.json({ success: true, data: response } satisfies ApiResponse<PlannerResponse>);
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
