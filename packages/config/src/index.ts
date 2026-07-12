import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..", "..", "..");

const envFiles = [
  path.join(workspaceRoot, ".env"),
  path.join(workspaceRoot, ".env.local"),
  path.join(workspaceRoot, ".env.development"),
  path.join(workspaceRoot, ".env.production"),
];

const envFile = envFiles.find((candidate) => existsSync(candidate));

const normalizeLowercase = (value: unknown) => (typeof value === "string" ? value.toLowerCase() : value);

const SupportedProviderSchema = z.enum(["openai", "gemini", "openrouter", "ollama", "local"]);
const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);

export const loadEnvironment = (overridePath?: string) => {
  const candidatePath = overridePath ?? envFile;
  if (candidatePath) {
    const parsed = loadDotenv({ path: candidatePath });
    if (parsed.error) {
      console.warn(`[config] failed to load ${candidatePath}: ${parsed.error.message}`);
    }
  }

  return {
    envFile: candidatePath ?? null,
    loadedKeys: Object.keys(process.env).filter((key) => key.startsWith("MONGODB") || key.startsWith("EMBED") || key.startsWith("LLM") || key.startsWith("OPENAI") || key.includes("PORT") || key.includes("TIMEOUT") || key.includes("RATE_LIMIT") || key.includes("LOG_LEVEL") || key.includes("SERVICE") || key.includes("URL") || key.includes("PROVIDER") || key.includes("MODEL") || key.includes("BASE_URL") || key.includes("DIMENSION")),
  };
};

const RuntimeConfigSchema = z.object({
  nodeEnv: z.string().default("development"),
  servicePort: z.number().int().positive().optional(),
  requestTimeoutMs: z.number().int().positive().default(45000),
  rateLimitMax: z.number().int().positive().default(120),
  rateLimitWindowMs: z.number().int().positive().default(60000),
  logLevel: z.preprocess(
    normalizeLowercase,
    LogLevelSchema.default("info"),
  ),
  enableMetrics: z.boolean().default(true),
  mongodbUri: z.string().min(1),
  mongodbDatabase: z.string().min(1),
  llmProvider: z.preprocess(normalizeLowercase, SupportedProviderSchema.default("local")),
  llmApiKey: z.string().optional(),
  llmModel: z.string().default("anthropic/claude-haiku-4.5"),
  llmBaseUrl: z.string().default("https://openrouter.ai/api/v1"),
  openAiApiKey: z.string().optional(),
  embeddingProvider: z.preprocess(normalizeLowercase, SupportedProviderSchema.default("local")),
  embeddingApiKey: z.string().optional(),
  embeddingModel: z.string().default("text-embedding-3-small"),
  embeddingBaseUrl: z.string().default("https://api.openai.com/v1"),
  embeddingDimension: z.number().int().positive().default(1536),
  serviceRetryCount: z.number().int().nonnegative().default(3),
  serviceRetryDelayMs: z.number().int().nonnegative().default(1000),
  serviceRequestTimeoutMs: z.number().int().positive().default(30000),
});

export type AppConfig = z.infer<typeof RuntimeConfigSchema>;

const parseNumber = (value: string | undefined, fallback: number) => {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

export const getAppConfig = () => {
  const runtime = loadEnvironment();
  const parsed = RuntimeConfigSchema.safeParse({
    nodeEnv: process.env.NODE_ENV,
    servicePort: parseNumber(process.env.PORT, 0),
    requestTimeoutMs: parseNumber(process.env.REQUEST_TIMEOUT_MS, 45000),
    rateLimitMax: parseNumber(process.env.RATE_LIMIT_MAX, 120),
    rateLimitWindowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    logLevel: process.env.LOG_LEVEL,
    enableMetrics: parseBoolean(process.env.ENABLE_METRICS, true),
    mongodbUri: process.env.MONGODB_URI,
    mongodbDatabase: process.env.MONGODB_DATABASE || "wireup",
    llmProvider: process.env.LLM_PROVIDER,
    llmApiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
    llmModel: process.env.LLM_MODEL || "anthropic/claude-haiku-4.5",
    llmBaseUrl: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
    openAiApiKey: process.env.OPENAI_API_KEY,
    embeddingProvider: process.env.EMBEDDING_PROVIDER || "local",
    embeddingApiKey: process.env.EMBEDDING_API_KEY,
    embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    embeddingBaseUrl: process.env.EMBEDDING_BASE_URL || "https://api.openai.com/v1",
    embeddingDimension: parseNumber(process.env.EMBEDDING_DIMENSION, 1536),
    serviceRetryCount: parseNumber(process.env.SERVICE_RETRY_COUNT, 3),
    serviceRetryDelayMs: parseNumber(process.env.SERVICE_RETRY_DELAY_MS, 1000),
    serviceRequestTimeoutMs: parseNumber(process.env.SERVICE_REQUEST_TIMEOUT_MS, 30000),
  });

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid application configuration: ${JSON.stringify(errors)}`);
  }

  if (parsed.data.llmProvider !== "local" && parsed.data.llmProvider !== "ollama" && !parsed.data.llmApiKey) {
    throw new Error("LLM_API_KEY is required for remote LLM providers");
  }

  return {
    ...parsed.data,
    runtime,
  };
};

export const maskSecret = (value?: string) => {
  if (!value) return "<not-set>";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
};

export const getWorkspaceRoot = () => workspaceRoot;
