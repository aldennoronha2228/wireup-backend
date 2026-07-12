import { readFile, writeFile, rm } from "fs/promises";
import { spawn } from "child_process";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import type {
  Component,
  GeneratorResponse,
  SimulationJson,
} from "@wireup/types";

interface VelxioComponentMeta {
  id: string;
  tagName: string;
  name: string;
  tags?: string[];
  defaultValues?: Record<string, unknown>;
}

interface VelxioComponentCatalog {
  components: VelxioComponentMeta[];
}

export interface VelxioCircuit {
  board_fqbn: string;
  components: Array<{ id: string; type: string; left: number; top: number; rotate: number; attrs: Record<string, unknown> }>;
  connections: Array<{ from_part: string; from_pin: string; to_part: string; to_pin: string; color: string }>;
  version: number;
}

export interface VelxioAssets {
  circuit: VelxioCircuit;
  wiringDiagram: Record<string, unknown>;
  circuitDiagram: Record<string, unknown>;
}

const baseDir = dirname(fileURLToPath(import.meta.url));
const velxioRoot = resolve(baseDir, "../../../vendor/velxio");
const velxioBackend = join(velxioRoot, "backend");
const velxioCatalogPath = join(
  velxioRoot,
  "frontend",
  "public",
  "components-metadata.json",
);

let catalogCache: VelxioComponentMeta[] | null = null;

const loadCatalog = async (): Promise<VelxioComponentMeta[]> => {
  if (catalogCache) return catalogCache;
  const raw = await readFile(velxioCatalogPath, "utf8");
  const parsed = JSON.parse(raw) as VelxioComponentCatalog;
  catalogCache = parsed.components || [];
  return catalogCache;
};

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const scoreMatch = (component: Component, meta: VelxioComponentMeta) => {
  const nameTokens = new Set([
    ...normalize(component.name).split(" "),
    ...normalize(component.description).split(" "),
    ...normalize(component.type).split(" "),
  ].filter(Boolean));

  const metaTokens = new Set([
    ...normalize(meta.name).split(" "),
    ...normalize(meta.id).split(" "),
    ...(meta.tags ?? []).flatMap((tag) => normalize(tag).split(" ")),
  ].filter(Boolean));

  let score = 0;
  nameTokens.forEach((token) => {
    if (metaTokens.has(token)) score += 3;
  });

  if (normalize(component.name) === normalize(meta.name)) score += 10;
  if (normalize(component.name).includes(normalize(meta.id))) score += 5;
  if ((meta.tags ?? []).some((tag) => normalize(component.name).includes(normalize(tag)))) {
    score += 2;
  }

  return score;
};

const resolveBoardFqbn = (generatorOutput: GeneratorResponse) => {
  const tags = generatorOutput.projectMetadata.tags.map((tag) => tag.toLowerCase());
  if (tags.some((tag) => tag.includes("esp32"))) return "esp32:esp32:esp32";
  if (tags.some((tag) => tag.includes("stm32"))) return "stm32:stm32:bluepill";
  if (tags.some((tag) => tag.includes("raspberry"))) return "rp2040:rp2040:rpipico";
  return "arduino:avr:uno";
};

const resolveVelxioComponent = async (component: Component, index: number) => {
  const catalog = await loadCatalog();
  let best: VelxioComponentMeta | null = null;
  let bestScore = -1;

  for (const meta of catalog) {
    const score = scoreMatch(component, meta);
    if (score > bestScore) {
      best = meta;
      bestScore = score;
    }
  }

  const tagName = best?.tagName ?? "wokwi-led";
  const attrs = {
    ...(best?.defaultValues ?? {}),
    ...(component.specifications ?? {}),
  };

  return {
    id: component.id,
    type: tagName,
    left: 160 + (index % 4) * 140,
    top: 120 + Math.floor(index / 4) * 120,
    rotate: 0,
    attrs,
  };
};

const connectionColor = (type: string) => {
  switch (type) {
    case "power":
      return "#ff0000";
    case "ground":
      return "#000000";
    case "analog":
      return "#4169e1";
    case "digital":
    default:
      return "#00ff00";
  }
};

const buildVelxioCircuit = async (generatorOutput: GeneratorResponse) => {
  const board_fqbn = resolveBoardFqbn(generatorOutput);
  const components = await Promise.all(
    generatorOutput.componentList.map(resolveVelxioComponent),
  );

  const boardId = "uno";
  const connections = generatorOutput.wiring.connections.map((connection) => {
    const fromIsBoard = connection.from.componentId === "platform";
    const toIsBoard = connection.to.componentId === "platform";

    return {
      from_part: fromIsBoard ? boardId : connection.from.componentId,
      from_pin: fromIsBoard ? connection.from.platformPin : connection.from.pinName,
      to_part: toIsBoard ? boardId : connection.to.componentId,
      to_pin: toIsBoard ? connection.to.platformPin : connection.to.pinName,
      color: connectionColor(connection.type),
    };
  });

  return {
    board_fqbn,
    components,
    connections,
    version: 1,
  } satisfies VelxioCircuit;
};

export const buildVelxioCircuitFromSimulationJson = async (
  simulationJson: SimulationJson,
): Promise<VelxioCircuit> => {
  const components = await Promise.all(
    simulationJson.components.map(async (component, index) => {
      const tagName = component.type.includes("led") ? "wokwi-led" : "wokwi-pushbutton";
      return {
        id: component.id,
        type: tagName,
        left: 120 + (index % 3) * 140,
        top: 120 + Math.floor(index / 3) * 120,
        rotate: 0,
        attrs: component.properties,
      };
    }),
  );

  const connections = simulationJson.connections.map((connection) => ({
    from_part: connection.from.componentId,
    from_pin: connection.from.pin,
    to_part: connection.to.componentId,
    to_pin: connection.to.pin,
    color: "#00ff00",
  }));

  return {
    board_fqbn: "arduino:avr:uno",
    components,
    connections,
    version: 1,
  } satisfies VelxioCircuit;
};

const formatWokwiDiagram = async (circuit: VelxioCircuit) => {
  const pythonBin = process.env.VELXIO_PYTHON_BIN || "python";
  const scriptPath = join(
    resolve(process.env.TEMP || process.env.TMP || "."),
    `velxio-format-${randomUUID()}.py`,
  );

  const script = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(velxioBackend)})`,
    "from app.mcp.wokwi import format_wokwi_diagram",
    "payload = json.load(sys.stdin)",
    "print(json.dumps(format_wokwi_diagram(payload)))",
  ].join("\n");

  await writeFile(scriptPath, script, "utf8");

  return new Promise<Record<string, unknown>>((resolvePromise, reject) => {
    const proc = spawn(pythonBin, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (error) => {
      reject(error);
    });

    proc.on("close", async (code) => {
      await rm(scriptPath, { force: true });
      if (code !== 0) {
        reject(new Error(stderr || "Velxio diagram format failed"));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });

    proc.stdin.write(JSON.stringify(circuit));
    proc.stdin.end();
  });
};

export const buildVelxioAssets = async (
  generatorOutput: GeneratorResponse,
): Promise<VelxioAssets> => {
  const circuit = await buildVelxioCircuit(generatorOutput);
  const circuitDiagram = await formatWokwiDiagram(circuit);

  return {
    circuit,
    wiringDiagram: {
      connections: circuit.connections,
      board: circuit.board_fqbn,
    },
    circuitDiagram,
  };
};
