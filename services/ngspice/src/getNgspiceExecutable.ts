import { spawnSync } from "child_process";
import { dirname, join, resolve } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

export interface NgspiceCandidate {
  path: string;
  exists: boolean;
  source: "bundled" | "environment" | "system-path";
  resolvedPath: string;
  verified: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  verificationSkipped?: boolean;
}

const unique = (values: string[]) => Array.from(new Set(values));
const versionArgs = ["-v"];
const verificationTimeoutMs = 5000;

const buildBundledCandidates = () => {
  const baseDir = dirname(fileURLToPath(import.meta.url));
  const serviceDir = resolve(baseDir, "..");
  const repoRootFromService = resolve(serviceDir, "..", "..");
  const cwd = process.cwd();

  const roots = unique([
    cwd,
    resolve(cwd, ".."),
    resolve(cwd, "..", ".."),
    repoRootFromService,
  ]);

  return unique([
    ...roots.flatMap((root) => [
      resolve(root, "vendor", "ngspice", "Spice64", "bin", "ngspice_con.exe"),
      resolve(root, "vendor", "ngspice", "Spice64", "bin", "ngspice.exe"),
      resolve(root, "vendor", "ngspice", "ngspice_con.exe"),
      resolve(root, "vendor", "ngspice", "ngspice.exe"),
      resolve(root, "services", "ngspice", "vendor", "ngspice", "ngspice_con.exe"),
      resolve(root, "services", "ngspice", "vendor", "ngspice", "ngspice.exe"),
      resolve(root, "services", "vendor", "ngspice", "ngspice_con.exe"),
      resolve(root, "services", "vendor", "ngspice", "ngspice.exe"),
    ]),
    join(serviceDir, "vendor", "ngspice", "ngspice_con.exe"),
    join(serviceDir, "vendor", "ngspice", "ngspice.exe"),
    join(serviceDir, "..", "vendor", "ngspice", "ngspice_con.exe"),
    join(serviceDir, "..", "vendor", "ngspice", "ngspice.exe"),
  ]).map((candidate) => resolve(candidate));
};

const exists = (path: string) => {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
};

const stripSurroundingQuotes = (value: string) => value.trim().replace(/^["']|["']$/g, "");

const resolveCandidatePath = (path: string, source: NgspiceCandidate["source"]) =>
  source === "system-path" ? path : resolve(stripSurroundingQuotes(path));

const verifyExecutable = (path: string) => {
  const result = spawnSync(path, versionArgs, {
    encoding: "utf8",
    timeout: verificationTimeoutMs,
    windowsHide: true,
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const error = result.error instanceof Error ? result.error.message : undefined;

  return {
    verified: !result.error && result.status === 0,
    exitCode: result.status,
    stdout,
    stderr,
    error,
  };
};

const toCandidate = (path: string, source: NgspiceCandidate["source"]): NgspiceCandidate => {
  const resolvedPath = resolveCandidatePath(path, source);
  const candidateExists = source === "system-path" ? true : exists(resolvedPath);

  return {
    path,
    resolvedPath,
    exists: candidateExists,
    source,
    verified: false,
    exitCode: null,
    stdout: "",
    stderr: "",
    verificationSkipped: candidateExists,
  };
};

export function getNgspiceCandidates(): NgspiceCandidate[] {
  const bundled = buildBundledCandidates().map((path) => toCandidate(path, "bundled"));

  const environment = unique([
    process.env.NGSPICE_PATH || "",
    process.env.NGSPICE_BIN || "",
  ])
    .filter(Boolean)
    .map((path) => toCandidate(path, "environment"));

  return [...bundled, ...environment, toCandidate("ngspice", "system-path")];
}

export function getNgspiceDiscoveryReport() {
  const candidates = getNgspiceCandidates();
  let selected: NgspiceCandidate | null = null;

  for (const candidate of candidates) {
    if (!candidate.exists) continue;

    const verification = verifyExecutable(candidate.resolvedPath);
    Object.assign(candidate, verification, { verificationSkipped: false });

    if (candidate.verified) {
      selected = candidate;
      break;
    }
  }

  return {
    candidates,
    selected,
    versionArgs,
  };
}

export function getNgspiceExecutable(): string {
  const { candidates, selected } = getNgspiceDiscoveryReport();
  if (selected) return selected.resolvedPath;

  throw new Error(
    `NGSpice executable not found. Searched: ${candidates
      .map((candidate) => `${candidate.resolvedPath} (exists=${candidate.exists}, verified=${candidate.verified})`)
      .join(", ")}`,
  );
}

export function getNgspiceBatchArgs(netlistPath: string) {
  // use batch mode -b
  return ["-b", netlistPath];
}
