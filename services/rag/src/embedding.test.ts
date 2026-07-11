import { describe, expect, it } from "vitest";
import { getEmbedding } from "./embedding.js";
import type { RagConfig } from "./config.js";

const baseConfig: RagConfig = {
  mongodbUri: "mongodb://localhost:27017",
  mongodbDatabase: "rag_db",
  mongodbCollectionDocuments: "documents",
  mongodbCollectionChunks: "chunks",
  mongodbCollectionKnowledgeGraph: "knowledge_graph",
  mongodbVectorIndex: "vector_index",
  mongodbTextIndex: "text_index",
  mongodbKgTextIndex: "kg_text_index",
  embeddingProvider: "local",
  embeddingApiKey: undefined,
  embeddingModel: "text-embedding-3-small",
  embeddingBaseUrl: "https://api.openai.com/v1",
  embeddingDimension: 16,
  defaultMatchCount: 10,
  maxMatchCount: 50,
  requestTimeoutMs: 30000,
  mongoQueryTimeoutMs: 5000,
};

describe("getEmbedding", () => {
  it("returns a deterministic local embedding", async () => {
    const first = await getEmbedding("hello", baseConfig);
    const second = await getEmbedding("hello", baseConfig);

    expect(first).toHaveLength(baseConfig.embeddingDimension);
    expect(first).toEqual(second);
  });
});
