import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getAppConfig, loadEnvironment } from "@wireup/config";
import { pathToFileURL } from "url";
import { NgspiceRequestSchema, type NgspiceResponse } from "./schema.js";
import { NgspiceService } from "./service.js";
import {
  createCommonMiddleware,
  createLogger,
  createMetricsCollector,
  getRuntimeConfig,
  registerGracefulShutdown,
  registerHealthRoutes,
  registerMetricsRoute,
} from "@wireup/utils";

export { NgspiceService, type NgspiceServiceLike } from "./service.js";
export type { NgspiceRequest, NgspiceResponse } from "./schema.js";

loadEnvironment();
const serviceName = "ngspice";
const runtimeConfig = getRuntimeConfig(serviceName);
const logger = createLogger(serviceName);
const metrics = createMetricsCollector();
const appConfig = getAppConfig();
const ngspiceService = new NgspiceService();

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
      service: "ngspice",
      timestamp: new Date().toISOString(),
      method,
      event,
      ...payload,
    }),
  );
};

const errorPayload = (method: string, error: unknown, payload: unknown) => ({
  service: "ngspice",
  method,
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
  payload,
});

app.post("/api/ngspice/validate", async (c) => {
  const startedAt = Date.now();
  const body = await c.req.json();
  trace("POST /api/ngspice/validate", "request_received", {
    success: true,
    request: body,
  });

  const parsed = NgspiceRequestSchema.safeParse(body);

  if (!parsed.success) {
    trace("POST /api/ngspice/validate", "response_returned", {
      success: false,
      durationMs: Date.now() - startedAt,
      error: parsed.error.flatten(),
    });
    return c.json(
      {
        errors: [
          {
            code: "VALIDATION_ERROR",
            message: "Invalid ngspice request",
            details: parsed.error.flatten(),
          },
        ],
        warnings: [],
        voltages: {},
        currents: {},
        summary: {
          status: "invalid",
          totalErrors: 1,
          totalWarnings: 0,
          ngspiceExitCode: null,
        },
      } satisfies NgspiceResponse,
      400,
    );
  }

  try {
    const response = await ngspiceService.validate(parsed.data);
    trace("POST /api/ngspice/validate", "response_returned", {
      success: response.summary.status === "valid",
      durationMs: Date.now() - startedAt,
      response,
    });
    console.log(`[NGSpice] completed in ${Date.now() - startedAt} ms`);

    return c.json(response satisfies NgspiceResponse);
  } catch (error) {
    trace("POST /api/ngspice/validate", "exception", {
      success: false,
      durationMs: Date.now() - startedAt,
      error: errorPayload("POST /api/ngspice/validate", error, body),
    });
    console.log(`[NGSpice] completed in ${Date.now() - startedAt} ms`);
    throw error;
  }
});

registerHealthRoutes(app, serviceName);
registerMetricsRoute(app, metrics, serviceName);

const startServer = () => {
  const port = runtimeConfig.port;
  logger.info("service_starting", { port, envFile: appConfig.runtime.envFile });
  (async () => {
    try {
      const { testNgspiceExecutable } = await import("./ngspice.js");
      const result = await testNgspiceExecutable();
      if (result && result.path) {
        logger.info("ngspice_check", { path: result.path, exitCode: result.exitCode, stdout: result.stdout });
      } else {
        logger.warn("ngspice_missing", { error: result.stderr });
      }
    } catch (err) {
      logger.warn("ngspice_check_failed", { error: err instanceof Error ? err.message : String(err) });
    }

    const server = serve({
      fetch: app.fetch,
      port,
    });

    registerGracefulShutdown(server as any, logger);
  })();
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
