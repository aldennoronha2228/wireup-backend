import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getNgspiceExecutable, getNgspiceBatchArgs } from "./getNgspiceExecutable.js";

export interface NgspiceExecution {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const timeoutMs = Number(process.env.NGSPICE_TIMEOUT_MS) || 8000;

export const runNgspice = async (netlist: string): Promise<NgspiceExecution> => {
  const bin = getNgspiceExecutable();
  const filePath = join(tmpdir(), `wireup-ngspice-${Date.now()}.cir`);
  await writeFile(filePath, netlist, "utf8");

  return new Promise((resolve) => {
    const args = getNgspiceBatchArgs(filePath);
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
      await rm(filePath, { force: true });
      resolve({ exitCode: code, stdout, stderr });
    });

    child.on("error", async (error: Error) => {
      clearTimeout(timer);
      await rm(filePath, { force: true });
      resolve({ exitCode: null, stdout: "", stderr: String(error) });
    });
  });
};

/**
 * Run a self-test to check NGSpice availability and version.
 */
export async function testNgspiceExecutable(): Promise<{ path: string; exitCode: number | null; stdout: string; stderr: string }> {
  try {
    const bin = getNgspiceExecutable();
    return await new Promise((resolve) => {
      const child = spawn(bin, ["-v"]) as ChildProcessWithoutNullStreams;
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("close", (code: number | null) => resolve({ path: bin, exitCode: code, stdout, stderr }));
      child.on("error", (err: Error) => resolve({ path: bin, exitCode: null, stdout: "", stderr: String(err) }));
    });
  } catch (err) {
    return Promise.resolve({ path: "", exitCode: null, stdout: "", stderr: (err instanceof Error ? err.message : String(err)) });
  }
}
