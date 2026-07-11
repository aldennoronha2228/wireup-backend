import { spawn } from "child_process";
import { writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export interface NgspiceExecution {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const timeoutMs = Number(process.env.NGSPICE_TIMEOUT_MS) || 8000;

export const runNgspice = async (netlist: string): Promise<NgspiceExecution> => {
  const bin =
    process.env.NGSPICE_BIN ||
    join(process.cwd(), "vendor", "ngspice", "build", "dist", "bin", "ngspice");

  const filePath = join(tmpdir(), `wireup-ngspice-${Date.now()}.cir`);
  await writeFile(filePath, netlist, "utf8");

  return new Promise((resolve) => {
    const child = spawn(bin, ["-b", filePath]);
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", async (code) => {
      clearTimeout(timer);
      await rm(filePath, { force: true });
      resolve({ exitCode: code, stdout, stderr });
    });

    child.on("error", async (error) => {
      clearTimeout(timer);
      await rm(filePath, { force: true });
      resolve({ exitCode: null, stdout: "", stderr: String(error) });
    });
  });
};
