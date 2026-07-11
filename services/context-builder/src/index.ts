import { serve } from "@hono/node-server";
import { getAppConfig, loadEnvironment } from "@wireup/config";
import { getRuntimeConfig } from "@wireup/utils";
import { createApp } from "./app.js";

loadEnvironment();
const maxContextChars = Number(process.env.CONTEXT_MAX_CHARS) || 2000;
const maxItems = Number(process.env.CONTEXT_MAX_ITEMS) || 12;

const app = createApp({ maxContextChars, maxItems });
const runtimeConfig = getRuntimeConfig("context-builder");
const appConfig = getAppConfig();

console.log(`[startup] ${runtimeConfig.serviceName} loaded env from ${appConfig.runtime.envFile ?? "<default>"}`);
console.log(`Context Builder service is running on port ${runtimeConfig.port}`);

serve({
  fetch: app.fetch,
  port: runtimeConfig.port,
});
