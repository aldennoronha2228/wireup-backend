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

const explainNetlistReadiness = (
  request: NgspiceRequest,
  netlist: string,
) => {
  const reasons: string[] = [];

  if (!request.components.length) reasons.push("request.components is empty");
  if (!request.connections.length) reasons.push("request.connections is empty");
  if (!netlist.trim()) reasons.push("netlist string is empty");
  if (!netlist.includes(".op")) reasons.push("netlist does not include .op analysis");
  if (!netlist.includes(".end")) reasons.push("netlist does not include .end terminator");
  if (!/^[RCDV]_/m.test(netlist)) {
    reasons.push("netlist contains no recognized passive, diode, or voltage-source primitive");
  }
  if (!netlist.includes("V_VCC")) {
    reasons.push("netlist has no VCC voltage source; no power rail was detected from connections");
  }

  return reasons;
};

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
      const { netlist } = buildNetlist(request);
      trace("validate", "generated_netlist", {
        success: Boolean(netlist),
        netlist,
      });

      const netlistReasons = explainNetlistReadiness(request, netlist);
      if (netlistReasons.length > 0) {
        trace("validate", "netlist_readiness", {
          success: false,
          reason: "Generated netlist may not be executable or meaningful",
          reasons: netlistReasons,
          request,
          netlist,
        });
      }

      const issues = {
        errors: [] as NgspiceResponse["errors"],
        warnings: [] as NgspiceResponse["warnings"],
      };

      if (!netlist) {
        issues.errors.push({
          code: "NETLIST_EMPTY",
          message: "Netlist could not be generated",
          details: { reasons: netlistReasons },
        });
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
