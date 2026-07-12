import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { existsSync } from "fs";

export function getNgspiceExecutable(): string {
  const baseDir = dirname(fileURLToPath(import.meta.url));

  const candidates = [] as string[];

  // Prefer vendor prebuilt
  candidates.push(resolve(process.cwd(), "vendor", "ngspice", "ngspice_con.exe"));
  candidates.push(resolve(process.cwd(), "vendor", "ngspice", "ngspice.exe"));

  // Also allow relative path from package
  candidates.push(join(baseDir, "..", "..", "vendor", "ngspice", "ngspice_con.exe"));
  candidates.push(join(baseDir, "..", "..", "vendor", "ngspice", "ngspice.exe"));

  // Check environment override
  if (process.env.NGSPICE_BIN) candidates.unshift(process.env.NGSPICE_BIN);

  for (const cand of candidates) {
    if (!cand) continue;
    try {
      if (existsSync(cand)) return resolve(cand);
    } catch {
      // ignore
    }
  }

  throw new Error(`NGSpice executable not found. Searched: ${candidates.join(", ")}`);
}

export function getNgspiceBatchArgs(netlistPath: string) {
  // use batch mode -b
  return ["-b", netlistPath];
}
