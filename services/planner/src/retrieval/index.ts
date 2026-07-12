import { RetrieverClient, type SearchQuery } from "./tavily-client";
import {
  extractTechnicalKnowledge,
  scoreKnowledgeConfidence,
  type HardwareContext,
} from "./knowledge-extractor";
import {
  generateSearchQueries,
  generateFastQueries,
} from "./search-generator";

export interface RetrievalConfig {
  apiKey: string;
  enabled?: boolean;
  timeout?: number;
  maxRetries?: number;
  useFastQueries?: boolean;
}

export interface RetrievalResult {
  success: boolean;
  context: HardwareContext;
  confidence: number;
  queriesExecuted: string[];
  executionTimeMs: number;
  error?: string;
}

/**
 * Orchestrates retrieval-first planning:
 * 1. Generate focused search queries from prompt
 * 2. Execute searches in parallel
 * 3. Extract technical knowledge
 * 4. Build structured hardware context
 */
export class RetrievalService {
  private client?: RetrieverClient;
  private config: RetrievalConfig;

  constructor(config: RetrievalConfig) {
    this.config = {
      enabled: config.enabled ?? true,
      timeout: config.timeout,
      useFastQueries: config.useFastQueries ?? false,
      ...config,
    };

    if (!this.config.enabled) {
      console.warn(
        "RetrieverClient is disabled; Planner will use knowledge base only",
      );
    } else {
      this.client = new RetrieverClient({
        apiKey: this.config.apiKey,
        timeout: this.config.timeout,
        maxRetries: this.config.maxRetries,
      });
    }
  }

  /**
   * Execute retrieval pipeline for a user prompt.
   */
  async retrieve(prompt: string): Promise<RetrievalResult> {
    const startTime = Date.now();

    if (!this.config.enabled) {
      return {
        success: false,
        context: {
          platform: "unknown",
          components: [],
          libraries: [],
          pinMappings: [],
          powerRequirements: [],
          communicationProtocols: [],
          warnings: [
            "Retrieval is disabled; using knowledge base only",
          ],
          sources: [],
          rawExtract: "",
        },
        confidence: 0,
        queriesExecuted: [],
        executionTimeMs: 0,
        error: "Retrieval service is disabled",
      };
    }

    const queries: SearchQuery[] = this.config.useFastQueries
      ? generateFastQueries(prompt)
      : generateSearchQueries(prompt);

    console.log(`[Retriever] Starting retrieval with ${queries.length} queries`);
    queries.forEach((q, i) => console.log(`  Query ${i + 1}: ${q.query}`));

    try {
      // Execute searches in parallel
      const searchResults = await this.client!.searchParallel(queries);

      // Extract knowledge
      const context = extractTechnicalKnowledge(searchResults);

      // Score confidence
      const confidence = scoreKnowledgeConfidence(context);

      const executionTimeMs = Date.now() - startTime;

      console.log(
        `[Retriever] Completed in ${executionTimeMs}ms with confidence ${confidence.toFixed(2)}`,
      );
      console.log(
        `[Retriever] Found ${context.components.length} components, ${context.libraries.length} libraries`,
      );

      return {
        success: true,
        context,
        confidence,
        queriesExecuted: queries.map((q) => q.query),
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMsg =
        error instanceof Error ? error.message : String(error);

      console.error(`[Retriever] Retrieval failed: ${errorMsg}`);

      return {
        success: false,
        context: {
          platform: "unknown",
          components: [],
          libraries: [],
          pinMappings: [],
          powerRequirements: [],
          communicationProtocols: [],
          warnings: [`Retrieval failed: ${errorMsg}`],
          sources: [],
          rawExtract: "",
        },
        confidence: 0,
        queriesExecuted: queries.map((q) => q.query),
        executionTimeMs,
        error: errorMsg,
      };
    }
  }
}

/**
 * Factory function with environment-aware configuration.
 */
export function createRetrievalService(
  overrides?: Partial<RetrievalConfig>,
): RetrievalService {
  const apiKey =
    overrides?.apiKey || process.env.TAVILY_API_KEY || "";

  return new RetrievalService({
    apiKey,
    enabled: process.env.RETRIEVAL_ENABLED !== "false",
    timeout: overrides?.timeout,
    useFastQueries: process.env.USE_FAST_QUERIES === "true",
    ...overrides,
  });
}
