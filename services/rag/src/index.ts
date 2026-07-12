import { serve } from "@hono/node-server";
import { getAppConfig, loadEnvironment } from "@wireup/config";
import { getRuntimeConfig } from "@wireup/utils";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { getMongoClient, maskMongoUri } from "./mongo.js";

loadEnvironment();
const config = loadConfig();
const app = createApp(config);
const runtimeConfig = getRuntimeConfig("rag");
const appConfig = getAppConfig();
const logger = {
  info: (message: string, details?: Record<string, unknown>) => console.log(message, details ?? {}),
  warn: (message: string, details?: Record<string, unknown>) => console.warn(message, details ?? {}),
  error: (message: string, details?: Record<string, unknown>) => console.error(message, details ?? {}),
};

console.log(`[startup] ${runtimeConfig.serviceName} loaded env from ${appConfig.runtime.envFile ?? "<default>"}`);
console.log(`[startup] ${runtimeConfig.serviceName} mongodb uri ${maskMongoUri(appConfig.mongodbUri)}`);
console.log(`[startup] ${runtimeConfig.serviceName} database ${config.mongodbDatabase}`);
console.log(`[startup] ${runtimeConfig.serviceName} llm provider ${appConfig.llmProvider}`);
console.log(
  `[startup] ${runtimeConfig.serviceName} collections ${config.mongodbCollectionDocuments}, ${config.mongodbCollectionChunks}, ${config.mongodbCollectionKnowledgeGraph}`,
);
console.log(
  `[startup] ${runtimeConfig.serviceName} search indexes ${config.mongodbVectorIndex}, ${config.mongodbTextIndex}, ${config.mongodbKgTextIndex}`,
);
console.log(`[startup] ${runtimeConfig.serviceName} embedding provider ${config.embeddingProvider}`);
console.log(`[startup] ${runtimeConfig.serviceName} attempting MongoDB connection...`);

void getMongoClient(config, logger)
  .then(() => {
    console.log(`[startup] ${runtimeConfig.serviceName} MongoDB connected`);
    console.log(`[startup] ${runtimeConfig.serviceName} MongoDB ping successful`);
    console.log(`[startup] ${runtimeConfig.serviceName} RAG Ready`);
  })
  .catch((error) => {
    console.error(`[startup] ${runtimeConfig.serviceName} MongoDB startup failed`, error);
  });

console.log(`RAG service is running on port ${runtimeConfig.port}`);

serve({
  fetch: app.fetch,
  port: runtimeConfig.port,
});
