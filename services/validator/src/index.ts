import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
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

const serviceName = "validator";
const runtimeConfig = getRuntimeConfig(serviceName);
const logger = createLogger(serviceName);
const metrics = createMetricsCollector();

const app = new Hono();

app.use("*", cors());
app.use("*", ...createCommonMiddleware(runtimeConfig, logger, metrics));



app.post("/api/validator/validate", async (c) => {
  const body = await c.req.json();
  const parsed = ValidatorRequestSchema.safeParse(body);

  if (!parsed.success) {
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

  const response: ValidatorResponse = await validateElectrical(
    parsed.data.generatorOutput,
  );

  return c.json({ success: true, data: response } satisfies ApiResponse<ValidatorResponse>);
});

registerHealthRoutes(app, serviceName);
registerMetricsRoute(app, metrics, serviceName);

const port = runtimeConfig.port;
logger.info("service_starting", { port });

const server = serve({
  fetch: app.fetch,
  port,
});

registerGracefulShutdown(server as any, logger);
