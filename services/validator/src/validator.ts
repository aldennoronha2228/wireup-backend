import {
  ValidationErrorType,
  ValidationWarningType,
  type GeneratorResponse,
  type ValidationError,
  type ValidationWarning,
  type ValidatorResponse,
} from "@wireup/types";
import { ServiceClient } from "@wireup/utils";

interface NgspiceIssue {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface NgspiceResponse {
  errors: NgspiceIssue[];
  warnings: NgspiceIssue[];
  voltages: Record<string, number>;
  currents: Record<string, number>;
  summary: {
    status: "valid" | "invalid";
    totalErrors: number;
    totalWarnings: number;
    ngspiceExitCode: number | null;
  };
}

interface NgspiceRequest {
  circuitId?: string;
  components: GeneratorResponse["componentList"];
  connections: GeneratorResponse["wiring"]["connections"];
  board: {
    platform: string;
    voltage?: number;
    groundPins?: string[];
    powerPins?: string[];
  };
}

const buildNgspiceRequest = (generatorOutput: GeneratorResponse): NgspiceRequest => ({
  circuitId: generatorOutput.projectMetadata.title,
  components: generatorOutput.componentList,
  connections: generatorOutput.wiring.connections,
  board: {
    platform: generatorOutput.projectMetadata.tags[0] || "unknown",
  },
});

const mapIssueToError = (issue: NgspiceIssue): ValidationError => {
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

const mapIssueToWarning = (issue: NgspiceIssue): ValidationWarning => {
  return {
    type: ValidationWarningType.POTENTIAL_NOISE,
    message: issue.message,
    details: issue.details ?? {},
  };
};

export const validateElectrical = async (
  generatorOutput: GeneratorResponse,
  service?: ServiceClient,
): Promise<ValidatorResponse> => {
  const client =
    service ||
    new ServiceClient({
      baseUrl: process.env.NGSPICE_URL || "http://localhost:3010",
    });

  const ngspiceResponse = await client.post<NgspiceResponse>(
    "/api/ngspice/validate",
    buildNgspiceRequest(generatorOutput),
  );

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
