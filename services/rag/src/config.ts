import { z } from "zod";

const ConfigSchema = z.object({
  mongodbUri: z.string().min(1),
  mongodbDatabase: z.string().default("rag_db"),
  mongodbCollectionDocuments: z.string().default("documents"),
  mongodbCollectionChunks: z.string().default("chunks"),
  mongodbCollectionKnowledgeGraph: z.string().default("knowledge_graph"),
  mongodbVectorIndex: z.string().default("vector_index"),
  mongodbTextIndex: z.string().default("text_index"),
  mongodbKgTextIndex: z.string().default("kg_text_index"),
  embeddingProvider: z.enum(["openai", "local", "gemini"]).default("local"),
  embeddingApiKey: z.string().optional(),
  embeddingModel: z.string().default("text-embedding-3-small"),
  embeddingBaseUrl: z.string().default("https://api.openai.com/v1"),
  embeddingDimension: z.number().int().positive().default(1536),
  defaultMatchCount: z.number().int().positive().default(10),
  maxMatchCount: z.number().int().positive().default(50),
  requestTimeoutMs: z.number().int().positive().default(30000),
  mongoQueryTimeoutMs: z.number().int().positive().default(5000),
});

export type RagConfig = z.infer<typeof ConfigSchema>;

export const loadConfig = () => {
  const parsed = ConfigSchema.safeParse({
    mongodbUri: process.env.MONGODB_URI,
    mongodbDatabase: process.env.MONGODB_DATABASE,
    mongodbCollectionDocuments: process.env.MONGODB_COLLECTION_DOCUMENTS,
    mongodbCollectionChunks: process.env.MONGODB_COLLECTION_CHUNKS,
    mongodbCollectionKnowledgeGraph: process.env.MONGODB_COLLECTION_KG,
    mongodbVectorIndex: process.env.MONGODB_VECTOR_INDEX,
    mongodbTextIndex: process.env.MONGODB_TEXT_INDEX,
    mongodbKgTextIndex: process.env.MONGODB_KG_TEXT_INDEX,
    embeddingProvider: process.env.EMBEDDING_PROVIDER,
    embeddingApiKey: process.env.EMBEDDING_API_KEY,
    embeddingModel: process.env.EMBEDDING_MODEL,
    embeddingBaseUrl: process.env.EMBEDDING_BASE_URL,
    embeddingDimension: process.env.EMBEDDING_DIMENSION
      ? Number(process.env.EMBEDDING_DIMENSION)
      : undefined,
    defaultMatchCount: process.env.RAG_DEFAULT_MATCH_COUNT
      ? Number(process.env.RAG_DEFAULT_MATCH_COUNT)
      : undefined,
    maxMatchCount: process.env.RAG_MAX_MATCH_COUNT
      ? Number(process.env.RAG_MAX_MATCH_COUNT)
      : undefined,
    requestTimeoutMs: process.env.RAG_REQUEST_TIMEOUT_MS
      ? Number(process.env.RAG_REQUEST_TIMEOUT_MS)
      : undefined,
    mongoQueryTimeoutMs: process.env.RAG_MONGO_QUERY_TIMEOUT_MS
      ? Number(process.env.RAG_MONGO_QUERY_TIMEOUT_MS)
      : undefined,
  });

  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    const message = "Invalid RAG configuration";
    throw new Error(`${message}: ${JSON.stringify(details)}`);
  }

  if (parsed.data.embeddingProvider !== "local" && !parsed.data.embeddingApiKey) {
    throw new Error("EMBEDDING_API_KEY is required for remote embedding providers");
  }

  return parsed.data;
};
