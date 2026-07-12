/**
 * Tavily API response types
 */
interface TavilyApiResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

interface TavilyApiResponse {
  answer?: string;
  response_time: number;
  results: TavilyApiResult[];
}

interface TavilyApiError {
  error?: string;
  message?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  source: string;
}

export interface SearchQuery {
  query: string;
  maxResults?: number;
  includeAnswer?: boolean;
}

export interface TavilyClientConfig {
  apiKey: string;
  timeout?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Production-ready Tavily API client using native fetch().
 * Handles retries, timeouts, and structured result extraction.
 */
export class RetrieverClient {
  private readonly apiKey: string;
  private readonly apiUrl = "https://api.tavily.com/search";
  private config: Required<TavilyClientConfig>;

  constructor(config: TavilyClientConfig) {
    if (!config.apiKey) {
      throw new Error("TAVILY_API_KEY is required for RetrieverClient");
    }

    this.apiKey = config.apiKey;
    this.config = {
      apiKey: config.apiKey,
      timeout: config.timeout ?? 30000,
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000,
    };
  }

  /**
   * Search with retry logic for transient failures.
   */
  async search(
    searchQuery: SearchQuery,
    attempt = 1,
  ): Promise<SearchResult[]> {
    try {
      console.log(
        `[Tavily] Searching (attempt ${attempt}): "${searchQuery.query}"`,
      );

      const controller = new AbortController();
      const timeoutHandle = setTimeout(
        () => controller.abort(),
        this.config.timeout,
      );

      const requestBody = {
        api_key: this.apiKey,
        query: searchQuery.query,
        max_results: searchQuery.maxResults ?? 5,
        include_answer: searchQuery.includeAnswer ?? false,
      };

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutHandle);

      // Handle HTTP errors
      if (!response.ok) {
        const errorText = await response.text();
        const errorData = this.parseErrorResponse(errorText);
        const errorMsg = errorData.message || errorData.error || response.statusText;
        throw new Error(
          `Tavily API error (${response.status}): ${errorMsg}`,
        );
      }

      const data: TavilyApiResponse = await response.json();

      // Validate response structure
      if (!Array.isArray(data.results)) {
        throw new Error("Invalid Tavily API response: missing results array");
      }

      console.log(
        `[Tavily] Got ${data.results.length} results in ${data.response_time}s`,
      );

      // Convert Tavily results to SearchResult format
      return data.results.map((result) => ({
        title: String(result.title ?? ""),
        url: String(result.url ?? ""),
        content: String(result.content ?? ""),
        source: this.extractDomain(String(result.url ?? "")),
      }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check if error is retryable (timeout, network, 5xx errors)
      const isRetryable =
        errorMsg.includes("timeout") ||
        errorMsg.includes("AbortError") ||
        errorMsg.includes("Failed to fetch") ||
        (errorMsg.includes("500") ||
          errorMsg.includes("502") ||
          errorMsg.includes("503") ||
          errorMsg.includes("504"));

      if (isRetryable && attempt < this.config.maxRetries) {
        const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
        console.warn(
          `[Tavily] Retrying in ${delay}ms due to: ${errorMsg}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.search(searchQuery, attempt + 1);
      }

      console.error(
        `[Tavily] Search failed after ${attempt} attempts: ${errorMsg}`,
      );
      return [];
    }
  }

  /**
   * Run multiple searches in parallel.
   */
  async searchParallel(queries: SearchQuery[]): Promise<SearchResult[][]> {
    const results = await Promise.all(
      queries.map((query) => this.search(query)),
    );
    return results;
  }

  /**
   * Extract domain from URL for source attribution.
   */
  private extractDomain(urlStr: string): string {
    try {
      const url = new URL(urlStr);
      return url.hostname;
    } catch {
      return "unknown";
    }
  }

  /**
   * Parse error response from Tavily API.
   */
  private parseErrorResponse(text: string): TavilyApiError {
    try {
      return JSON.parse(text) as TavilyApiError;
    } catch {
      return { message: text };
    }
  }
}
