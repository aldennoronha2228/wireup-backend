import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp(config);

const port = Number(process.env.PORT) || 3002;
console.log(`RAG service is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
