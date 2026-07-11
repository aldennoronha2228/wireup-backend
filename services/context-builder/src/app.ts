import { Hono } from "hono";
import { cors } from "hono/cors";
import { ContextBuilderRequestSchema } from "@wireup/schemas";
import type { ApiResponse, ContextBuilderResponse } from "@wireup/types";
import {
  createCommonMiddleware,
  createLogger,
  createMetricsCollector,
  getRuntimeConfig,
  registerHealthRoutes,
  registerMetricsRoute,
} from "@wireup/utils";
import { buildOptimizedContext } from "./context-builder.js";

export interface ContextBuilderConfig {
  maxContextChars: number;
  maxItems: number;
}

export const createApp = (config: ContextBuilderConfig) => {
  const app = new Hono();
  const runtimeConfig = getRuntimeConfig("context-builder");
  const logger = createLogger("context-builder");
  const metrics = createMetricsCollector();

  app.use("*", cors());
  app.use("*", ...createCommonMiddleware(runtimeConfig, logger, metrics));

  app.post("/api/context-builder/build", async (c) => {
    const body = await c.req.json();
    const parsed = ContextBuilderRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid context builder request",
            details: parsed.error.flatten(),
          },
        } satisfies ApiResponse<ContextBuilderResponse>,
        400,
      );
    }

    const { context, compressionRatio } = buildOptimizedContext(
      parsed.data.ragResponse.context,
      {
        maxContextChars: config.maxContextChars,
        maxItems: config.maxItems,
      },
    );

    const response: ContextBuilderResponse = {
      query: parsed.data.query,
      context,
      totalHits: context.length,
      compressionRatio,
    };

    return c.json({ success: true, data: response } satisfies ApiResponse<ContextBuilderResponse>);
  });

  registerHealthRoutes(app, "context-builder");
  registerMetricsRoute(app, metrics, "context-builder");

  return app;
};
