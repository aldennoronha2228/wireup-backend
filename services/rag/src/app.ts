import { Hono } from "hono";
import { cors } from "hono/cors";
import { RagQuerySchema } from "@wireup/schemas";
import type { ApiResponse, RagResponse } from "@wireup/types";
import {
  createCommonMiddleware,
  createLogger,
  createMetricsCollector,
  getRuntimeConfig,
  registerHealthRoutes,
  registerMetricsRoute,
} from "@wireup/utils";
import type { RagConfig } from "./config.js";
import { dedupeResults, hybridSearch, knowledgeGraphSearch, rerankResults } from "./search.js";
import { getMongoClient, getMongoHealthReport } from "./mongo.js";
import { buildVendorSearchSummary } from "./vendorAdapter.js";

export const createApp = (config: RagConfig) => {
  const app = new Hono();
  const runtimeConfig = getRuntimeConfig("rag");
  const logger = createLogger("rag");
  const metrics = createMetricsCollector();

  app.use("*", cors());
  app.use("*", ...createCommonMiddleware(runtimeConfig, logger, metrics));

  app.post("/api/rag/query", async (c) => {
    const body = await c.req.json();
    const parsed = RagQuerySchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid RAG query",
            details: parsed.error.flatten(),
          },
        } satisfies ApiResponse<RagResponse>,
        400,
      );
    }

    const matchCount = Math.min(
      parsed.data.topK ?? config.defaultMatchCount,
      config.maxMatchCount,
    );

    try {
      const client = await getMongoClient(config, logger);
      const db = client.db(config.mongodbDatabase);
      const chunkCollection = db.collection(config.mongodbCollectionChunks);
      const knowledgeGraphCollection = db.collection(
        config.mongodbCollectionKnowledgeGraph,
      );

      const [hybridResult, kgResult] = await Promise.allSettled([
        hybridSearch(chunkCollection, config, parsed.data.query, matchCount),
        knowledgeGraphSearch(
          knowledgeGraphCollection,
          config,
          parsed.data.query,
          Math.max(1, Math.floor(matchCount / 2)),
        ),
      ]);

      const hybridResults =
        hybridResult.status === "fulfilled" ? hybridResult.value : [];
      const knowledgeGraphResults =
        kgResult.status === "fulfilled" ? kgResult.value : [];

      const summary = buildVendorSearchSummary(
        hybridResults,
        knowledgeGraphResults,
        matchCount,
      );
      const combined = rerankResults(
        dedupeResults(summary.results),
      ).slice(0, matchCount);

      const response: RagResponse = {
        query: parsed.data.query,
        context: combined.map((item) => ({
          id: item.id,
          type: item.type,
          content: item.content,
          metadata: item.metadata,
          score: item.score,
        })),
        totalHits: combined.length,
      };

      return c.json({ success: true, data: response } satisfies ApiResponse<RagResponse>);
    } catch (error) {
      return c.json(
        {
          success: false,
          error: {
            code: "RAG_QUERY_FAILED",
            message:
              error instanceof Error ? error.message : "RAG query failed",
          },
        } satisfies ApiResponse<RagResponse>,
        500,
      );
    }
  });

  app.get("/health", async (c) => {
    const mongo = await getMongoHealthReport(config, logger);

    if (mongo.connected) {
      return c.json({
        success: true,
        mongo,
      });
    }

    return c.json(
      {
        success: false,
        mongo,
      },
      503,
    );
  });

  registerHealthRoutes(app, "rag");
  registerMetricsRoute(app, metrics, "rag");

  return app;
};
