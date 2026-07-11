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



app.post("/api/generator/generate", async (c) => {
  const body = await c.req.json();
  const parsed = GeneratorRequestSchema.safeParse(body);

  if (!parsed.success) {
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

  const response: GeneratorResponse = buildGeneratorOutput(parsed.data.plannerOutput);

  return c.json({ success: true, data: response } satisfies ApiResponse<GeneratorResponse>);
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
