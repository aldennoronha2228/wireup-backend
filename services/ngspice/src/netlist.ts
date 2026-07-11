import type { NgspiceRequest } from "./schema.js";

interface NetlistBuildResult {
  netlist: string;
  nodeMap: Map<string, string>;
  powerVoltage: number;
}

const normalizeId = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, "_");

class UnionFind {
  private parent = new Map<string, string>();

  add(value: string) {
    if (!this.parent.has(value)) {
      this.parent.set(value, value);
    }
  }

  find(value: string): string {
    const parent = this.parent.get(value) ?? value;
    if (parent !== value) {
      const root = this.find(parent);
      this.parent.set(value, root);
      return root;
    }
    return parent;
  }

  union(a: string, b: string) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent.set(rootB, rootA);
    }
  }

  entries() {
    return Array.from(this.parent.keys());
  }
}

const parseNumeric = (value: unknown): number | null => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const match = value.match(/([0-9]+(\.[0-9]+)?)/);
    if (match) return Number(match[1]);
  }
  return null;
};

const detectPowerVoltage = (request: NgspiceRequest) => {
  if (request.board.voltage) return request.board.voltage;
  const voltages = request.components
    .map((component) => parseNumeric(component.specifications?.voltage))
    .filter((value): value is number => value !== null);
  if (voltages.includes(3.3)) return 3.3;
  if (voltages.includes(5)) return 5;
  return 5;
};

const endpointKey = (componentId: string, pinName: string) =>
  `${componentId}:${pinName}`;

export const buildNetlist = (request: NgspiceRequest): NetlistBuildResult => {
  const uf = new UnionFind();

  request.connections.forEach((connection) => {
    const fromPin = connection.from.platformPin || connection.from.pinName;
    const toPin = connection.to.platformPin || connection.to.pinName;

    const fromKey = endpointKey(connection.from.componentId, fromPin);
    const toKey = endpointKey(connection.to.componentId, toPin);

    uf.add(fromKey);
    uf.add(toKey);
    uf.union(fromKey, toKey);
  });

  const groundTokens = new Set(["gnd", "ground", "0"]);
  const powerTokens = new Set(["vcc", "5v", "3v3", "vdd", "power"]);

  const nodeMap = new Map<string, string>();
  const nodeNames = new Map<string, string>();
  let nodeIndex = 0;

  uf.entries().forEach((entry) => {
    const root = uf.find(entry);
    if (!nodeNames.has(root)) {
      const pinName = entry.split(":")[1]?.toLowerCase() ?? "";
      if (groundTokens.has(pinName)) {
        nodeNames.set(root, "0");
      } else if (powerTokens.has(pinName)) {
        nodeNames.set(root, "vcc_rail");
      } else {
        nodeNames.set(root, `n${nodeIndex++}`);
      }
    }
    nodeMap.set(entry, nodeNames.get(root) ?? "0");
  });

  const lines: string[] = ["* WireUp Ngspice netlist", ".options abstol=1n reltol=1u"];
  const powerVoltage = detectPowerVoltage(request);

  if (Array.from(nodeNames.values()).includes("vcc_rail")) {
    lines.push(`V_VCC vcc_rail 0 ${powerVoltage}`);
  }

  request.components.forEach((component, index) => {
    const spec = component.specifications || {};
    const resistance = parseNumeric(spec.resistance);
    const capacitance = parseNumeric(spec.capacitance);
    const pinKeys = request.connections
      .filter((connection) =>
        [connection.from.componentId, connection.to.componentId].includes(component.id),
      )
      .map((connection) => {
        const pin =
          connection.from.componentId === component.id
            ? connection.from.pinName
            : connection.to.pinName;
        return endpointKey(component.id, pin);
      });

    const nodeA = nodeMap.get(pinKeys[0] ?? "") ?? "0";
    const nodeB = nodeMap.get(pinKeys[1] ?? "") ?? "0";

    if (resistance) {
      lines.push(`R_${normalizeId(component.id)} ${nodeA} ${nodeB} ${resistance}`);
    }

    if (capacitance) {
      lines.push(`C_${normalizeId(component.id)} ${nodeA} ${nodeB} ${capacitance}`);
    }

    if (!resistance && !capacitance && component.type.toLowerCase().includes("led")) {
      lines.push(`D_${normalizeId(component.id)} ${nodeA} ${nodeB} DLED`);
    }

    if (component.type.toLowerCase().includes("diode")) {
      lines.push(`D_${normalizeId(component.id)} ${nodeA} ${nodeB} DSTD`);
    }
  });

  lines.push(".model DLED D(IS=1e-12 N=2)");
  lines.push(".model DSTD D(IS=1e-14 N=1.7)");
  lines.push(".op");
  lines.push(".end");

  return { netlist: lines.join("\n"), nodeMap, powerVoltage };
};
