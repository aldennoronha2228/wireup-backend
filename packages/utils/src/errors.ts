import type { ApiError } from "@wireup/types";

export class WireUpError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor({ code, message, details }: ApiError) {
    super(message);
    this.name = "WireUpError";
    this.code = code;
    this.details = details;
  }

  toApiError(): ApiError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class ServiceUnavailableError extends WireUpError {
  constructor(serviceName: string, details?: Record<string, unknown>) {
    super({
      code: "SERVICE_UNAVAILABLE",
      message: `Service ${serviceName} is unavailable`,
      details,
    });
    this.name = "ServiceUnavailableError";
  }
}

export class ValidationError extends WireUpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: "VALIDATION_ERROR",
      message,
      details,
    });
    this.name = "ValidationError";
  }
}

export class NotFoundError extends WireUpError {
  constructor(resource: string, details?: Record<string, unknown>) {
    super({
      code: "NOT_FOUND",
      message: `${resource} not found`,
      details,
    });
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends WireUpError {
  constructor(message = "Unauthorized", details?: Record<string, unknown>) {
    super({
      code: "UNAUTHORIZED",
      message,
      details,
    });
    this.name = "UnauthorizedError";
  }
}
