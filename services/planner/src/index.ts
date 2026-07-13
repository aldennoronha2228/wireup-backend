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
import { buildPlanWithRetrieval } from "./planner.js";

loadEnvironment();
const serviceName = "planner";
const runtimeConfig = getRuntimeConfig(serviceName);
const logger = createLogger(serviceName);
const metrics = createMetricsCollector();
const appConfig = getAppConfig();

const app = new Hono();

app.use("*", cors());
app.use("*", ...createCommonMiddleware(runtimeConfig, logger, metrics));

const trace = (
  method: string,
  event: string,
  payload: Record<string, unknown> = {},
) => {
  console.log(
    JSON.stringify({
      service: "planner",
      timestamp: new Date().toISOString(),
      method,
      event,
      ...payload,
    }),
  );
};

const errorPayload = (method: string, error: unknown, payload: unknown) => ({
  service: "planner",
  method,
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
  payload,
});

app.post("/api/planner/plan", async (c) => {
  const startedAt = Date.now();
  const body = await c.req.json();
  trace("POST /api/planner/plan", "request_received", {
    success: true,
    request: body,
  });

  const parsed = PlannerRequestSchema.safeParse(body);

  if (!parsed.success) {
    trace("POST /api/planner/plan", "response_returned", {
      success: false,
      durationMs: Date.now() - startedAt,
      error: parsed.error.flatten(),
    });
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

  try {
    const response: PlannerResponse = await buildPlanWithRetrieval({
      prompt: parsed.data.prompt,
      ragContext: parsed.data.ragContext,
      projectState: parsed.data.projectState,
      useRetrieval: true,
    });
    trace("POST /api/planner/plan", "response_returned", {
      success: true,
      durationMs: Date.now() - startedAt,
      response,
    });
    console.log(`[Planner] completed in ${Date.now() - startedAt} ms`);

    return c.json({ success: true, data: response } satisfies ApiResponse<PlannerResponse>);
  } catch (error) {
    trace("POST /api/planner/plan", "exception", {
      success: false,
      durationMs: Date.now() - startedAt,
      error: errorPayload("POST /api/planner/plan", error, body),
    });
    console.log(`[Planner] completed in ${Date.now() - startedAt} ms`);
    throw error;
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
