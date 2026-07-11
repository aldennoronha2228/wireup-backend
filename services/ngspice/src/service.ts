import { analyzeCircuit } from "./analyze.js";
import { buildNetlist } from "./netlist.js";
import { parseNgspiceOutput } from "./parser.js";
import { runNgspice, type NgspiceExecution } from "./ngspice.js";
import type { NgspiceRequest, NgspiceResponse } from "./schema.js";

export interface NgspiceServiceLike {
  validate(request: NgspiceRequest): Promise<NgspiceResponse>;
}

type NgspiceRunner = (netlist: string) => Promise<NgspiceExecution>;

export class NgspiceService implements NgspiceServiceLike {
  constructor(private readonly runner: NgspiceRunner = runNgspice) {}

  async validate(request: NgspiceRequest): Promise<NgspiceResponse> {
    const { netlist } = buildNetlist(request);
    const issues = {
      errors: [] as NgspiceResponse["errors"],
      warnings: [] as NgspiceResponse["warnings"],
    };

    if (!netlist) {
      issues.errors.push({
        code: "NETLIST_EMPTY",
        message: "Netlist could not be generated",
      });
    }

    const result = await this.runner(netlist);
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const parsedOutput = parseNgspiceOutput(output);

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

    return {
      errors: issues.errors,
      warnings: issues.warnings,
      voltages: parsedOutput.voltages,
      currents: parsedOutput.currents,
      summary,
    };
  }
}
