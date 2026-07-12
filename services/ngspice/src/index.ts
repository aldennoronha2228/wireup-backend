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

app.post("/api/ngspice/validate", async (c) => {
  const body = await c.req.json();
  const parsed = NgspiceRequestSchema.safeParse(body);

  if (!parsed.success) {
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

  const response = await ngspiceService.validate(parsed.data);

  return c.json(response satisfies NgspiceResponse);
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
