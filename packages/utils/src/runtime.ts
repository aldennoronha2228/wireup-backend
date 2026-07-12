import { randomUUID } from "crypto";
import { performance } from "perf_hooks";

export interface RuntimeConfig {
  serviceName: string;
  port: number;
  requestTimeoutMs: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  logLevel: "debug" | "info" | "warn" | "error";
  metricsEnabled: boolean;
}

export interface MetricsSnapshot {
  requests: number;
  errors: number;
  latencyMs: number;
  statusCodes: Record<string, number>;
}

const getServicePortEnvironmentVariable = (serviceName: string) => {
  return `${serviceName.toUpperCase().replace(/-/g, "_")}_PORT`;
};

const getDefaultPortForService = (serviceName: string) => {
  const defaults: Record<string, number> = {
    gateway: 3000,
    orchestrator: 3001,
    rag: 3002,
    planner: 3003,
    generator: 3004,
    validator: 3005,
    simulator: 3006,
    storage: 3007,
    "context-builder": 3008,
    ngspice: 3009,
  };

  return defaults[serviceName] ?? 3000;
};

const parseLogLevel = (value: string | undefined): RuntimeConfig["logLevel"] => {
  const normalized = value?.toLowerCase();
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }

  return "info";
};

export const getRuntimeConfig = (serviceName: string): RuntimeConfig => {
  const portEnvName = getServicePortEnvironmentVariable(serviceName);
  const configuredPort = Number(process.env[portEnvName] ?? getDefaultPortForService(serviceName));

  return {
    serviceName,
    port: Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : getDefaultPortForService(serviceName),
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS) || 45000,
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 120,
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    metricsEnabled: process.env.ENABLE_METRICS !== "false",
  };
};

export const createLogger = (serviceName: string) => {
  const log = (level: RuntimeConfig["logLevel"], message: string, details?: Record<string, unknown>) => {
    const timestamp = new Date().toISOString();
    const payload = {
      timestamp,
      service: serviceName,
      level,
      message,
      ...(details ?? {}),
    };

    const output = `[${timestamp}] ${serviceName} ${level.toUpperCase()}: ${message}`;
    if (level === "error") {
      console.error(output, details ?? {});
    } else if (level === "warn") {
      console.warn(output, details ?? {});
    } else if (level === "debug") {
      console.debug(output, details ?? {});
    } else {
      console.log(output, details ?? {});
    }

    return payload;
  };

  return {
    debug: (message: string, details?: Record<string, unknown>) => log("debug", message, details),
    info: (message: string, details?: Record<string, unknown>) => log("info", message, details),
    warn: (message: string, details?: Record<string, unknown>) => log("warn", message, details),
    error: (message: string, details?: Record<string, unknown>) => log("error", message, details),
  };
};

export const createMetricsCollector = () => {
  const state = {
    requests: 0,
    errors: 0,
    latencyMs: 0,
    statusCodes: {} as Record<string, number>,
  };

  return {
    recordRequest(statusCode: number, durationMs: number, isError: boolean) {
      state.requests += 1;
      state.latencyMs += durationMs;
      state.statusCodes[String(statusCode)] = (state.statusCodes[String(statusCode)] || 0) + 1;
      if (isError) state.errors += 1;
    },
    snapshot(): MetricsSnapshot {
      return {
        requests: state.requests,
        errors: state.errors,
        latencyMs: state.latencyMs,
        statusCodes: { ...state.statusCodes },
      };
    },
    toPrometheus(serviceName: string) {
      const snapshot = this.snapshot();
      return [
        `# HELP wireup_http_requests_total Total HTTP requests`,
        `# TYPE wireup_http_requests_total counter`,
        `wireup_http_requests_total{service="${serviceName}"} ${snapshot.requests}`,
        `# HELP wireup_http_errors_total Total HTTP errors`,
        `# TYPE wireup_http_errors_total counter`,
        `wireup_http_errors_total{service="${serviceName}"} ${snapshot.errors}`,
        `# HELP wireup_http_request_duration_ms Total request duration milliseconds`,
        `# TYPE wireup_http_request_duration_ms counter`,
        `wireup_http_request_duration_ms{service="${serviceName}"} ${snapshot.latencyMs}`,
      ].join("\n");
    },
  };
};

export const createRequestId = (c: any, fallback = randomUUID()) => {
  const headerValue = c.req.header("x-request-id") || c.req.header("X-Request-Id");
  const requestId = headerValue || fallback;
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  return requestId;
};

export const createCommonMiddleware = (
  config: RuntimeConfig,
  logger: ReturnType<typeof createLogger>,
  metrics: ReturnType<typeof createMetricsCollector>,
) => {
  const activeRequests = new Map<string, number[]>();

  return [
    async (c: any, next: () => Promise<void>) => {
      const requestId = createRequestId(c);
      const startedAt = performance.now();

      logger.info("request_started", {
        requestId,
        method: c.req.method,
        path: c.req.path,
      });

      const clientKey = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "local";
      const bucket = activeRequests.get(clientKey) || [];
      const now = Date.now();
      const recent = bucket.filter((timestamp) => now - timestamp < config.rateLimitWindowMs);
      if (recent.length >= config.rateLimitMax) {
        logger.warn("rate_limit_exceeded", { requestId, clientKey });
        c.header("Retry-After", String(Math.ceil(config.rateLimitWindowMs / 1000)));
        return c.json(
          {
            success: false,
            error: {
              code: "RATE_LIMITED",
              message: "Too many requests",
            },
          },
          429,
        );
      }
      recent.push(now);
      activeRequests.set(clientKey, recent);

      try {
        const timeout = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Request timed out")), config.requestTimeoutMs);
        });

        await Promise.race([next(), timeout]);
        const durationMs = performance.now() - startedAt;
        const statusCode = c.res?.status || 200;
        const isError = statusCode >= 400;
        metrics.recordRequest(statusCode, durationMs, isError);
        logger.info("request_completed", {
          requestId,
          method: c.req.method,
          path: c.req.path,
          statusCode,
          durationMs,
        });
      } catch (error) {
        const durationMs = performance.now() - startedAt;
        const statusCode = error instanceof Error && error.message === "Request timed out" ? 504 : 500;
        metrics.recordRequest(statusCode, durationMs, true);
        logger.error("request_failed", {
          requestId,
          method: c.req.method,
          path: c.req.path,
          statusCode,
          durationMs,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!c.res) {
          return c.json(
            {
              success: false,
              error: {
                code: statusCode === 504 ? "REQUEST_TIMEOUT" : "INTERNAL_SERVER_ERROR",
                message: statusCode === 504 ? "Request timed out" : "Internal server error",
              },
            },
            statusCode,
          );
        }
        throw error;
      }
    },
    async (c: any, next: () => Promise<void>) => {
      try {
        await next();
      } catch (error) {
        const requestId = c.get("requestId") || randomUUID();
        logger.error("unhandled_error", {
          requestId,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        return c.json(
          {
            success: false,
            error: {
              code: "INTERNAL_SERVER_ERROR",
              message: "Internal server error",
            },
          },
          500,
        );
      }
    },
  ];
};

export const registerHealthRoutes = (app: any, serviceName: string) => {
  app.get("/health", (c: any) => {
    return c.json({ success: true, data: { status: "ok", service: serviceName } });
  });

  app.get("/ready", (c: any) => {
    return c.json({ success: true, data: { status: "ready", service: serviceName } });
  });

  app.get("/live", (c: any) => {
    return c.json({ success: true, data: { status: "live", service: serviceName } });
  });
};

export const registerMetricsRoute = (app: any, metrics: ReturnType<typeof createMetricsCollector>, serviceName: string) => {
  app.get("/metrics", (c: any) => {
    c.header("Content-Type", "text/plain; charset=utf-8");
    return c.body(metrics.toPrometheus(serviceName));
  });
};

export const registerGracefulShutdown = (
  server: { close: (callback?: (error?: Error) => void) => void },
  logger: ReturnType<typeof createLogger>,
  cleanup?: () => Promise<void> | void,
) => {
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("graceful_shutdown_started", { signal });
    if (cleanup) {
      try {
        await cleanup();
      } catch (error) {
        logger.error("graceful_shutdown_cleanup_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    server.close(() => {
      logger.info("graceful_shutdown_completed");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};
