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

const buildNgspiceRequest = (generatorOutput: GeneratorResponse): NgspiceRequest => ({
  circuitId: generatorOutput.projectMetadata.title,
  components: generatorOutput.componentList,
  connections: generatorOutput.wiring.connections,
  board: {
    platform: generatorOutput.projectMetadata.tags[0] || "unknown",
  },
});

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
  const ngspice = service || new NgspiceService();

  const ngspiceResponse = await ngspice.validate(buildNgspiceRequest(generatorOutput));

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

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
};
