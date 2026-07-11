import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { chatRoutes } from "./routes/chat.js";
import {
  createCommonMiddleware,
  createLogger,
  createMetricsCollector,
  getRuntimeConfig,
  registerGracefulShutdown,
  registerHealthRoutes,
  registerMetricsRoute,
} from "@wireup/utils";

const serviceName = "gateway";
const runtimeConfig = getRuntimeConfig(serviceName);
const logger = createLogger(serviceName);
const metrics = createMetricsCollector();

const app = new Hono();

app.use("*", cors());
app.use("*", ...createCommonMiddleware(runtimeConfig, logger, metrics));

app.route("/api/chat", chatRoutes);

registerHealthRoutes(app, serviceName);
registerMetricsRoute(app, metrics, serviceName);

const port = runtimeConfig.port;
logger.info("service_starting", { port });

const server = serve({
  fetch: app.fetch,
  port,
});

registerGracefulShutdown(server as any, logger);
