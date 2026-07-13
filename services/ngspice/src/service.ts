import { analyzeCircuit } from "./analyze.js";
import { buildNetlist } from "./netlist.js";
import { parseNgspiceOutput } from "./parser.js";
import { runNgspice, type NgspiceExecution } from "./ngspice.js";
import type { NgspiceRequest, NgspiceResponse } from "./schema.js";

export interface NgspiceServiceLike {
  validate(request: NgspiceRequest): Promise<NgspiceResponse>;
}

type NgspiceRunner = (netlist: string) => Promise<NgspiceExecution>;

const trace = (
  method: string,
  event: string,
  payload: Record<string, unknown> = {},
) => {
  console.log(
    JSON.stringify({
      service: "ngspice",
      timestamp: new Date().toISOString(),
      method,
      event,
      ...payload,
    }),
  );
};

const errorPayload = (method: string, error: unknown, payload: unknown) => ({
  service: "ngspice",
  method,
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
  payload,
});

export class NgspiceService implements NgspiceServiceLike {
  constructor(private readonly runner: NgspiceRunner = runNgspice) {}

  async validate(request: NgspiceRequest): Promise<NgspiceResponse> {
    const startedAt = Date.now();

    trace("validate", "incoming_request", {
      success: true,
      request,
      componentCount: request.components.length,
      connectionCount: request.connections.length,
    });

    try {
      const build = buildNetlist(request);
      const { netlist } = build;
      trace("validate", "generated_netlist", {
        success: Boolean(netlist),
        netlist,
        nodeMap: Object.fromEntries(build.endpointToNet),
      });

      const issues = {
        errors: [...build.errors] as NgspiceResponse["errors"],
        warnings: [...build.warnings] as NgspiceResponse["warnings"],
      };

      if (!netlist) {
        issues.errors.push({
          code: "NETLIST_EMPTY",
          message: "Netlist could not be generated",
        });
      }

      if (issues.errors.length > 0) {
        if (process.env.NODE_ENV === "development") {
          console.log(`Generated SPICE netlist:\n${netlist}`);
        }
        trace("validate", "preflight_failed", {
          success: false,
          errors: issues.errors,
          warnings: issues.warnings,
          netlist,
        });

        const response = {
          errors: issues.errors,
          warnings: issues.warnings,
          voltages: {},
          currents: {},
          summary: {
            status: "invalid",
            totalErrors: issues.errors.length,
            totalWarnings: issues.warnings.length,
            ngspiceExitCode: null,
            suggestedFixes: suggestFixes(issues.errors),
          },
        } satisfies NgspiceResponse;

        trace("validate", "final_response", {
          success: false,
          durationMs: Date.now() - startedAt,
          response,
        });
        console.log(`[NGSpice] completed in ${Date.now() - startedAt} ms`);
        return response;
      }

      const result = await this.runner(netlist);
      trace("validate", "execution_result", {
        success: result.exitCode === 0,
        executablePath: result.executablePath,
        command: result.command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      });

      const output = `${result.stdout}\n${result.stderr}`.trim();
      const parsedOutput = parseNgspiceOutput(output);
      trace("validate", "parsed_output", {
        success: true,
        voltages: parsedOutput.voltages,
        currents: parsedOutput.currents,
        warnings: parsedOutput.warnings,
      });

      if (result.exitCode !== 0) {
        issues.errors.push({
          code: "NGSPICE_FAILED",
          message: "ngspice execution failed",
          details: { output },
        });
      }

      parsedOutput.warnings.forEach((warning) => {
        issues.warnings.push({
          code: "NGSPICE_WARNING",
          message: warning,
        });
      });

      if (Object.keys(parsedOutput.voltages).length === 0) {
        issues.warnings.push({
          code: "NO_VOLTAGES",
          message: "ngspice produced no voltage data",
        });
      }

      const analysis = analyzeCircuit(
        request,
        output,
        parsedOutput.voltages,
        parsedOutput.currents,
      );

      issues.errors.push(...analysis.errors);
      issues.warnings.push(...analysis.warnings);

      const summary: NgspiceResponse["summary"] = {
        status: issues.errors.length === 0 ? "valid" : "invalid",
        totalErrors: issues.errors.length,
        totalWarnings: issues.warnings.length,
        ngspiceExitCode: result.exitCode,
        suggestedFixes: analysis.suggestedFixes,
      };

      const response = {
        errors: issues.errors,
        warnings: issues.warnings,
        voltages: parsedOutput.voltages,
        currents: parsedOutput.currents,
        summary,
      };

      trace("validate", "final_response", {
        success: summary.status === "valid",
        durationMs: Date.now() - startedAt,
        response,
      });
      console.log(`[NGSpice] completed in ${Date.now() - startedAt} ms`);

      return response;
    } catch (error) {
      trace("validate", "exception", {
        success: false,
        durationMs: Date.now() - startedAt,
        error: errorPayload("validate", error, request),
      });
      console.log(`[NGSpice] completed in ${Date.now() - startedAt} ms`);
      throw error;
    }
  }
}

const suggestFixes = (errors: NgspiceResponse["errors"]) => {
  const fixes = new Set<string>();

  for (const error of errors) {
    if (error.code === "MISSING_GROUND") fixes.add("Connect the circuit to a ground pin so SPICE can use node 0.");
    if (error.code === "FLOATING_NODE") fixes.add("Tie floating nodes to another component, VCC, or ground.");
    if (error.code === "OPEN_CIRCUIT") fixes.add("Create a complete path between VCC and ground through connected components.");
    if (error.code === "SHORT_CIRCUIT") fixes.add("Separate the power rail from ground.");
    if (error.code === "MISSING_TERMINAL") fixes.add("Connect all required terminals for each simulated component.");
  }

  return Array.from(fixes);
};
