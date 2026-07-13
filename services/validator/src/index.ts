import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getAppConfig, loadEnvironment } from "@wireup/config";
import { ValidatorRequestSchema } from "@wireup/schemas";
import type { ApiResponse, ValidatorResponse } from "@wireup/types";
import {
  createCommonMiddleware,
  createLogger,
  createMetricsCollector,
  getRuntimeConfig,
  registerGracefulShutdown,
  registerHealthRoutes,
  registerMetricsRoute,
} from "@wireup/utils";
import { validateElectrical } from "./validator.js";

loadEnvironment();
const serviceName = "validator";
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
      service: "validator",
      timestamp: new Date().toISOString(),
      method,
      event,
      ...payload,
    }),
  );
};

const errorPayload = (method: string, error: unknown, payload: unknown) => ({
  service: "validator",
  method,
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
  payload,
});


app.post("/api/validator/validate", async (c) => {
  const startedAt = Date.now();
  const body = await c.req.json();
  trace("POST /api/validator/validate", "request_received", {
    success: true,
    request: body,
  });

  const parsed = ValidatorRequestSchema.safeParse(body);

  if (!parsed.success) {
    trace("POST /api/validator/validate", "response_returned", {
      success: false,
      durationMs: Date.now() - startedAt,
      error: parsed.error.flatten(),
    });
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid validator request",
          details: parsed.error.flatten(),
        },
      } satisfies ApiResponse<ValidatorResponse>,
      400,
    );
  }

  try {
    const response: ValidatorResponse = await validateElectrical(
      parsed.data.generatorOutput,
    );

    trace("POST /api/validator/validate", "response_returned", {
      success: true,
      durationMs: Date.now() - startedAt,
      response,
    });
    console.log(`[Validator] completed in ${Date.now() - startedAt} ms`);

    return c.json({ success: true, data: response } satisfies ApiResponse<ValidatorResponse>);
  } catch (error) {
    trace("POST /api/validator/validate", "exception", {
      success: false,
      durationMs: Date.now() - startedAt,
      error: errorPayload("POST /api/validator/validate", error, body),
    });
    console.log(`[Validator] completed in ${Date.now() - startedAt} ms`);
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
