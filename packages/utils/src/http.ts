import { randomUUID } from "crypto";
import { ofetch } from "ofetch";
import type { ApiResponse } from "@wireup/types";
import { WireUpError, ServiceUnavailableError } from "./errors.js";

interface ServiceConfig {
  baseUrl: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export class ServiceClient {
  private readonly fetch: typeof ofetch;

  constructor(private readonly config: ServiceConfig) {
    this.fetch = ofetch.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || Number(process.env.SERVICE_REQUEST_TIMEOUT_MS) || 30000,
      retry: config.retries || Number(process.env.SERVICE_RETRY_COUNT) || 3,
      retryDelay: config.retryDelay || Number(process.env.SERVICE_RETRY_DELAY_MS) || 1000,
    });
  }

  async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    try {
      const requestId = process.env.REQUEST_ID || crypto.randomUUID();
      const response = await this.fetch<ApiResponse<T>>(path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
      });

      if (!response.success) {
        throw new WireUpError(
          response.error || {
            code: "UNKNOWN_ERROR",
            message: "Unknown error occurred",
          },
        );
      }

      if (response.data === undefined) {
        throw new WireUpError({
          code: "NO_DATA",
          message: "No data returned from service",
        });
      }

      return response.data;
    } catch (error) {
      if (error instanceof WireUpError) {
        throw error;
      }
      throw new ServiceUnavailableError(this.config.baseUrl, {
        originalError: error,
      });
    }
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}
