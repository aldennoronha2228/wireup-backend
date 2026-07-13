import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getAppConfig, loadEnvironment } from "@wireup/config";
import { GeneratorRequestSchema } from "@wireup/schemas";
import type { ApiResponse, GeneratorResponse } from "@wireup/types";
import {
  createCommonMiddleware,
  createLogger,
  createMetricsCollector,
  getRuntimeConfig,
  registerGracefulShutdown,
  registerHealthRoutes,
  registerMetricsRoute,
} from "@wireup/utils";
import { buildGeneratorOutput } from "./generator.js";

loadEnvironment();
const serviceName = "generator";
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
      service: "generator",
      timestamp: new Date().toISOString(),
      method,
      event,
      ...payload,
    }),
  );
};

const errorPayload = (method: string, error: unknown, payload: unknown) => ({
  service: "generator",
  method,
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
  payload,
});



app.post("/api/generator/generate", async (c) => {
  const startedAt = Date.now();
  const body = await c.req.json();
  trace("POST /api/generator/generate", "request_received", {
    success: true,
    request: body,
  });

  const parsed = GeneratorRequestSchema.safeParse(body);

  if (!parsed.success) {
    trace("POST /api/generator/generate", "response_returned", {
      success: false,
      durationMs: Date.now() - startedAt,
      error: parsed.error.flatten(),
    });
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid generator request",
          details: parsed.error.flatten(),
        },
      } satisfies ApiResponse<GeneratorResponse>,
      400,
    );
  }

  try {
    const response: GeneratorResponse = buildGeneratorOutput(parsed.data.plannerOutput);
    trace("POST /api/generator/generate", "response_returned", {
      success: true,
      durationMs: Date.now() - startedAt,
      response,
    });
    console.log(`[Generator] completed in ${Date.now() - startedAt} ms`);

    return c.json({ success: true, data: response } satisfies ApiResponse<GeneratorResponse>);
  } catch (error) {
    trace("POST /api/generator/generate", "exception", {
      success: false,
      durationMs: Date.now() - startedAt,
      error: errorPayload("POST /api/generator/generate", error, body),
    });
    console.log(`[Generator] completed in ${Date.now() - startedAt} ms`);
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
