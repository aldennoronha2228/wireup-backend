import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const maxContextChars = Number(process.env.CONTEXT_MAX_CHARS) || 2000;
const maxItems = Number(process.env.CONTEXT_MAX_ITEMS) || 12;

const app = createApp({ maxContextChars, maxItems });

const port = Number(process.env.PORT) || 3008;
console.log(`Context Builder service is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
