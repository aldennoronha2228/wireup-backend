import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  getNgspiceBatchArgs,
  getNgspiceDiscoveryReport,
  getNgspiceExecutable,
  type NgspiceCandidate,
} from "./getNgspiceExecutable.js";

export interface NgspiceExecution {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  executablePath?: string;
  command?: string;
}

const timeoutMs = Number(process.env.NGSPICE_TIMEOUT_MS) || 8000;

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

export const runNgspice = async (netlist: string): Promise<NgspiceExecution> => {
  const bin = getNgspiceExecutable();
  const keepNetlist = process.env.NODE_ENV === "development";
  const fileName = `wireup-ngspice-${Date.now()}.cir`;
  const filePath = keepNetlist
    ? resolve(process.cwd(), "tmp", "netlists", fileName)
    : join(tmpdir(), fileName);
  if (keepNetlist) {
    await mkdir(resolve(process.cwd(), "tmp", "netlists"), { recursive: true });
    console.log(`Generated SPICE netlist:\n${netlist}`);
  }
  await writeFile(filePath, netlist, "utf8");

  return new Promise((resolve) => {
    const args = getNgspiceBatchArgs(filePath);
    const command = [bin, ...args].join(" ");
    trace("runNgspice", "executable_selected", {
      success: true,
      executablePath: bin,
      netlistPath: filePath,
    });
    trace("runNgspice", "command_executed", {
      success: true,
      command,
      timeoutMs,
    });
    const child = spawn(bin, args) as ChildProcessWithoutNullStreams;
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", async (code: number | null) => {
      clearTimeout(timer);
      if (!keepNetlist) await rm(filePath, { force: true });
      trace("runNgspice", "process_closed", {
        success: code === 0,
        exitCode: code,
        stdout,
        stderr,
      });
      resolve({ exitCode: code, stdout, stderr, executablePath: bin, command });
    });

    child.on("error", async (error: Error) => {
      clearTimeout(timer);
      if (!keepNetlist) await rm(filePath, { force: true });
      trace("runNgspice", "process_error", {
        success: false,
        executablePath: bin,
        command,
        stack: error.stack,
        stderr: String(error),
      });
      resolve({ exitCode: null, stdout: "", stderr: String(error), executablePath: bin, command });
    });
  });
};

/**
 * Run a self-test to check NGSpice availability and version.
 */
export async function testNgspiceExecutable(): Promise<{
  path: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  candidates: NgspiceCandidate[];
}> {
  try {
    const report = getNgspiceDiscoveryReport();
    const selected = report.selected;

    if (!selected) {
      return {
        path: "",
        exitCode: null,
        stdout: "",
        stderr: "NGSpice executable not found.",
        candidates: report.candidates,
      };
    }

    return {
      path: selected.resolvedPath,
      exitCode: selected.exitCode,
      stdout: selected.stdout,
      stderr: selected.stderr || selected.error || "",
      candidates: report.candidates,
    };
  } catch (err) {
    return Promise.resolve({
      path: "",
      exitCode: null,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      candidates: [],
    });
  }
}
