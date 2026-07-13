import {
  ValidationErrorType,
  ValidationWarningType,
  type GeneratorResponse,
  type ValidationError,
  type ValidationWarning,
  type ValidatorResponse,
} from "@wireup/types";
import type { NgspiceRequest, NgspiceResponse, NgspiceServiceLike } from "@wireup/ngspice";
import { NgspiceService } from "@wireup/ngspice";

const trace = (
  method: string,
  event: string,
  payload: Record<string, unknown> = {},
) => {
  console.log(
    JSON.stringify({
      service: "validator",
      timestamp: new Date().toISOString(),
      method,
      event,
      ...payload,
    }),
  );
};

const errorPayload = (
  service: string,
  method: string,
  error: unknown,
  payload: unknown,
) => ({
  service,
  method,
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
  payload,
});

const findMissingNgspiceFields = (generatorOutput: GeneratorResponse): string[] => {
  const missing: string[] = [];

  if (!generatorOutput) missing.push("generatorOutput");
  if (!generatorOutput?.projectMetadata) missing.push("generatorOutput.projectMetadata");
  if (!generatorOutput?.projectMetadata?.title) missing.push("generatorOutput.projectMetadata.title");
  if (!Array.isArray(generatorOutput?.projectMetadata?.tags)) {
    missing.push("generatorOutput.projectMetadata.tags");
  }
  if (!Array.isArray(generatorOutput?.componentList)) {
    missing.push("generatorOutput.componentList");
  } else if (generatorOutput.componentList.length === 0) {
    missing.push("generatorOutput.componentList[at least one component]");
  }
  if (!generatorOutput?.wiring) missing.push("generatorOutput.wiring");
  if (!Array.isArray(generatorOutput?.wiring?.connections)) {
    missing.push("generatorOutput.wiring.connections");
  } else if (generatorOutput.wiring.connections.length === 0) {
    missing.push("generatorOutput.wiring.connections[at least one connection]");
  }

  return missing;
};

const buildNgspiceRequest = (generatorOutput: GeneratorResponse): NgspiceRequest => {
  const missingFields = findMissingNgspiceFields(generatorOutput);
  if (missingFields.length > 0) {
    trace("buildNgspiceRequest", "insufficient_information", {
      success: false,
      missingFields,
      reason: "Generator output does not contain enough information to build a complete NgspiceRequest",
    });
    throw new Error(
      `Cannot build NgspiceRequest; missing required fields: ${missingFields.join(", ")}`,
    );
  }

  return {
    circuitId: generatorOutput.projectMetadata.title,
    components: generatorOutput.componentList,
    connections: generatorOutput.wiring.connections,
    board: {
      platform: generatorOutput.projectMetadata.tags[0] || "unknown",
    },
  };
};

const mapIssueToError = (issue: NgspiceResponse["errors"][number]): ValidationError => {
  const code = issue.code.toLowerCase();
  if (code.includes("floating") || code.includes("open")) {
    return {
      type: ValidationErrorType.INCOMPATIBLE_PINS,
      message: issue.message,
      details: issue.details ?? {},
    };
  }
  if (code.includes("voltage") || code.includes("short")) {
    return {
      type: ValidationErrorType.VOLTAGE_MISMATCH,
      message: issue.message,
      details: issue.details ?? {},
    };
  }
  if (code.includes("power")) {
    return {
      type: ValidationErrorType.SIMULATION_COMPATIBILITY,
      message: issue.message,
      details: issue.details ?? {},
    };
  }
  return {
    type: ValidationErrorType.SIMULATION_COMPATIBILITY,
    message: issue.message,
    details: issue.details ?? {},
  };
};

const mapIssueToWarning = (issue: NgspiceResponse["warnings"][number]): ValidationWarning => {
  return {
    type: ValidationWarningType.POTENTIAL_NOISE,
    message: issue.message,
    details: issue.details ?? {},
  };
};

export const validateElectrical = async (
  generatorOutput: GeneratorResponse,
  service?: NgspiceServiceLike,
): Promise<ValidatorResponse> => {
  const startedAt = Date.now();
  const ngspice = service || new NgspiceService();

  trace("validateElectrical", "request_received", {
    success: true,
    componentCount: generatorOutput?.componentList?.length ?? 0,
    connectionCount: generatorOutput?.wiring?.connections?.length ?? 0,
  });

  try {
    const missingFields = findMissingNgspiceFields(generatorOutput);
    if (missingFields.length > 0) {
      trace("validateElectrical", "ngspice_not_invoked", {
        success: false,
        reason: "buildNgspiceRequest has insufficient information",
        missingFields,
      });
    }

    trace("validateElectrical", "before_buildNgspiceRequest", {
      success: missingFields.length === 0,
      missingFields,
    });
    const ngspiceRequest = buildNgspiceRequest(generatorOutput);
    trace("validateElectrical", "ngspice_request_built", {
      success: true,
      ngspiceRequest,
    });

    trace("validateElectrical", "before_ngspice_validate", {
      success: true,
      ngspiceRequest,
      invocationMode: service ? "injected-service" : "in-process NgspiceService",
      note: service
        ? "Validator is using an injected Ngspice service implementation"
        : "Validator imports NgspiceService directly; this is not an HTTP call to the running NGSpice service",
    });
    const ngspiceResponse = await ngspice.validate(ngspiceRequest);
    trace("validateElectrical", "after_ngspice_validate", {
      success: true,
      durationMs: Date.now() - startedAt,
      ngspiceResponse,
    });
    trace("validateElectrical", "complete_ngspice_response", {
      success: true,
      ngspiceResponse,
    });

    const errors: ValidationError[] = ngspiceResponse.errors.map(mapIssueToError);
    const warnings: ValidationWarning[] = ngspiceResponse.warnings.map(mapIssueToWarning);

    const summary = {
      ...ngspiceResponse.summary,
      voltages: ngspiceResponse.voltages,
      currents: ngspiceResponse.currents,
    };

    if (errors.length > 0) {
      errors[0].details = {
        ...errors[0].details,
        summary,
      };
    } else if (warnings.length > 0) {
      warnings[0].details = {
        ...warnings[0].details,
        summary,
      };
    }

    const response = {
      isValid: errors.length === 0,
      errors,
      warnings,
    };

    trace("validateElectrical", "response_returned", {
      success: true,
      durationMs: Date.now() - startedAt,
      response,
    });
    console.log(`[Validator] completed in ${Date.now() - startedAt} ms`);

    return response;
  } catch (error) {
    trace("validateElectrical", "exception", {
      success: false,
      durationMs: Date.now() - startedAt,
      error: errorPayload("validator", "validateElectrical", error, generatorOutput),
    });
    console.log(`[Validator] completed in ${Date.now() - startedAt} ms`);
    throw error;
  }
};
