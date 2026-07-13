import type { NgspiceRequest } from "./schema.js";

export interface NetlistIssue {
  code: string;
  message: string;
  componentId?: string;
  pinName?: string;
  node?: string;
  details?: Record<string, unknown>;
}

export interface NetlistBuildResult {
  netlist: string;
  nodeMap: Map<string, string>;
  endpointToNet: Map<string, string>;
  powerVoltage: number;
  errors: NetlistIssue[];
  warnings: NetlistIssue[];
}

interface Terminal {
  pin: string;
  node: string;
}

const groundTokens = new Set(["gnd", "ground", "0", "vss"]);
const powerTokens = new Set(["vcc", "5v", "3v3", "3.3v", "vdd", "vin", "power"]);

const normalizeId = (value: string) => {
  const normalized = value.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z]/.test(normalized) ? normalized : `X${normalized}`;
};

const elementName = (prefix: string, id: string) => {
  const normalized = normalizeId(id);
  return normalized.toUpperCase().startsWith(prefix) ? normalized : `${prefix}${normalized}`;
};

class UnionFind {
  private parent = new Map<string, string>();

  add(value: string) {
    if (!this.parent.has(value)) {
      this.parent.set(value, value);
    }
  }

  find(value: string): string {
    this.add(value);
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
    const match = value.match(/([-+]?[0-9]+(\.[0-9]+)?)/);
    if (match) return Number(match[1]);
  }
  return null;
};

const formatSpiceValue = (value: unknown, fallback: string) => {
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
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

const endpointKeyFrom = (endpoint: { componentId: string; pinName: string; platformPin?: string }) =>
  endpointKey(
    endpoint.componentId,
    isBoardEndpoint(endpoint.componentId)
      ? endpoint.platformPin || endpoint.pinName
      : endpoint.pinName,
  );

const pinLabel = (endpoint: { pinName: string; platformPin?: string }) =>
  endpoint.platformPin || endpoint.pinName;

const terminalPinLabel = (endpoint: { componentId: string; pinName: string }) =>
  endpoint.pinName;

const netPinLabel = (endpoint: { componentId: string; pinName: string; platformPin?: string }) =>
  isBoardEndpoint(endpoint.componentId)
    ? endpoint.platformPin || endpoint.pinName
    : endpoint.pinName;

const isBoardEndpoint = (componentId: string) =>
  ["board", "mcu", "platform", "power", "supply"].includes(componentId.toLowerCase());

const isGroundPin = (pin: string, request: NgspiceRequest) => {
  const normalized = pin.toLowerCase();
  return groundTokens.has(normalized) || (request.board.groundPins ?? []).some((ground) => ground.toLowerCase() === normalized);
};

const isPowerPin = (pin: string, request: NgspiceRequest) => {
  const normalized = pin.toLowerCase();
  return powerTokens.has(normalized) || (request.board.powerPins ?? []).some((power) => power.toLowerCase() === normalized);
};

const componentKind = (component: NgspiceRequest["components"][number]) => {
  const combined = `${component.type} ${component.name}`.toLowerCase();
  if (combined.includes("resistor")) return "resistor";
  if (combined.includes("capacitor")) return "capacitor";
  if (combined.includes("inductor")) return "inductor";
  if (combined.includes("led")) return "led";
  if (combined.includes("diode")) return "diode";
  return "unknown";
};

const orderedTerminals = (terminals: Terminal[], preferredPins: string[]) => {
  const byPin = new Map(terminals.map((terminal) => [terminal.pin.toLowerCase(), terminal]));
  const preferred = preferredPins
    .map((pin) => byPin.get(pin))
    .filter((terminal): terminal is Terminal => Boolean(terminal));
  const remaining = terminals.filter((terminal) => !preferred.includes(terminal));
  return [...preferred, ...remaining];
};

export const buildNetlist = (request: NgspiceRequest): NetlistBuildResult => {
  const uf = new UnionFind();
  const errors: NetlistIssue[] = [];
  const warnings: NetlistIssue[] = [];
  const componentsById = new Map(request.components.map((component) => [component.id, component]));
  const componentPins = new Map<string, Map<string, Terminal>>();
  const endpointToNet = new Map<string, string>();
  const endpointUsage = new Map<string, number>();

  const addComponentTerminal = (componentId: string, pin: string, node = "") => {
    const pins = componentPins.get(componentId) ?? new Map<string, Terminal>();
    pins.set(pin, { pin, node });
    componentPins.set(componentId, pins);
  };

  for (const connection of request.connections) {
    for (const endpoint of [connection.from, connection.to]) {
      if (!isBoardEndpoint(endpoint.componentId) && !componentsById.has(endpoint.componentId)) {
        errors.push({
          code: "INVALID_COMPONENT_REFERENCE",
          message: `Connection references unknown component ${endpoint.componentId}.`,
          componentId: endpoint.componentId,
          pinName: endpoint.pinName,
          details: { componentId: endpoint.componentId, pinName: endpoint.pinName },
        });
      }
    }

    const fromKey = endpointKeyFrom(connection.from);
    const toKey = endpointKeyFrom(connection.to);
    endpointUsage.set(fromKey, (endpointUsage.get(fromKey) ?? 0) + 1);
    endpointUsage.set(toKey, (endpointUsage.get(toKey) ?? 0) + 1);
    uf.add(fromKey);
    uf.add(toKey);
    uf.union(fromKey, toKey);

    if (!isBoardEndpoint(connection.from.componentId)) {
      addComponentTerminal(connection.from.componentId, terminalPinLabel(connection.from));
    }
    if (!isBoardEndpoint(connection.to.componentId)) {
      addComponentTerminal(connection.to.componentId, terminalPinLabel(connection.to));
    }
  }

  for (const [endpoint, count] of endpointUsage) {
    const [componentId, pinName] = endpoint.split(":");
    if (count > 1 && !isBoardEndpoint(componentId)) {
      warnings.push({
        code: "DUPLICATE_PIN_USAGE",
        message: `${componentId}.${pinName} appears in multiple connections.`,
        details: { componentId, pinName, count },
      });
    }
  }

  const rootEntries = new Map<string, string[]>();
  for (const entry of uf.entries()) {
    const root = uf.find(entry);
    const entries = rootEntries.get(root) ?? [];
    entries.push(entry);
    rootEntries.set(root, entries);
  }

  const rootNames = new Map<string, string>();
  let nodeIndex = 1;
  let hasGround = false;
  let hasPower = false;

  for (const [root, entries] of rootEntries) {
    const containsGround = entries.some((entry) => {
      const [, pin] = entry.split(":");
      return isGroundPin(pin ?? "", request) || endpointTypeForNetEntry(request, entry) === "ground";
    });
    const containsPower = entries.some((entry) => {
      const [, pin] = entry.split(":");
      return isPowerPin(pin ?? "", request) || endpointTypeForNetEntry(request, entry) === "power";
    });

    if (containsGround && containsPower) {
      errors.push({
        code: "SHORT_CIRCUIT",
        message: "Power rail is directly connected to ground.",
        node: "0",
        details: { node: "0", endpoints: entries },
      });
    }

    if (containsGround) {
      rootNames.set(root, "0");
      hasGround = true;
    } else if (containsPower) {
      rootNames.set(root, "VCC");
      hasPower = true;
    } else {
      rootNames.set(root, `N${nodeIndex++}`);
    }
  }

  for (const entry of uf.entries()) {
    const node = rootNames.get(uf.find(entry)) ?? `N${nodeIndex++}`;
    endpointToNet.set(entry, node);
  }

  for (const [componentId, pins] of componentPins) {
    for (const terminal of pins.values()) {
      terminal.node = endpointToNet.get(endpointKey(componentId, terminal.pin)) ?? "";
    }
  }

  if (!hasGround) {
    errors.push({
      code: "MISSING_GROUND",
      message: "Circuit has no ground reference. SPICE ground must be node 0.",
    });
  }

  const powerVoltage = detectPowerVoltage(request);
  const lines: string[] = [`* ${request.circuitId || "WireUp NgSpice netlist"}`, ""];
  const usedModels = new Set<string>();
  const componentEdges: Array<{ componentId: string; from: string; to: string }> = [];

  if (hasPower && !errors.some((error) => error.code === "SHORT_CIRCUIT")) {
    lines.push(`VCC VCC 0 DC ${powerVoltage}`);
  }

  for (const component of request.components) {
    const kind = componentKind(component);
    const terminals = Array.from(componentPins.get(component.id)?.values() ?? [])
      .filter((terminal) => terminal.node);

    if (kind === "unknown") continue;

    if (terminals.length < 2) {
      errors.push({
        code: "MISSING_TERMINAL",
        message: `${component.name} does not have enough connected terminals for SPICE simulation.`,
        componentId: component.id,
        details: { componentId: component.id, connectedPins: terminals.map((terminal) => terminal.pin) },
      });
      errors.push({
        code: "FLOATING_NODE",
        message: `${component.name} has an unconnected terminal.`,
        componentId: component.id,
        details: { componentId: component.id, connectedPins: terminals.map((terminal) => terminal.pin) },
      });
      continue;
    }

    const [a, b] =
      kind === "led" || kind === "diode"
        ? orderedTerminals(terminals, ["anode", "a", "+", "1", "pin1"])
        : orderedTerminals(terminals, ["1", "pin1", "+"]);

    if (!a || !b) continue;

    if (a.node === b.node) {
      warnings.push({
        code: "COMPONENT_SHORTED",
        message: `${component.name} has both terminals on the same electrical node.`,
        details: { componentId: component.id, node: a.node },
      });
    }

    if (kind === "resistor") {
      lines.push(`${elementName("R", component.id)} ${a.node} ${b.node} ${formatSpiceValue(component.specifications?.resistance, "1000")}`);
      componentEdges.push({ componentId: component.id, from: a.node, to: b.node });
    } else if (kind === "capacitor") {
      lines.push(`${elementName("C", component.id)} ${a.node} ${b.node} ${formatSpiceValue(component.specifications?.capacitance, "1u")}`);
      componentEdges.push({ componentId: component.id, from: a.node, to: b.node });
    } else if (kind === "inductor") {
      lines.push(`${elementName("L", component.id)} ${a.node} ${b.node} ${formatSpiceValue(component.specifications?.inductance, "1m")}`);
      componentEdges.push({ componentId: component.id, from: a.node, to: b.node });
    } else if (kind === "led") {
      const diodeTerminals = orderedTerminals(terminals, ["anode", "a", "+", "1", "pin1", "cathode", "k", "-", "2", "pin2"]);
      const anode = diodeTerminals.find((terminal) => ["anode", "a", "+", "1", "pin1"].includes(terminal.pin.toLowerCase())) ?? diodeTerminals[0];
      const cathode = diodeTerminals.find((terminal) => ["cathode", "k", "-", "2", "pin2"].includes(terminal.pin.toLowerCase())) ?? diodeTerminals[1];
      lines.push(`${elementName("D", component.id)} ${anode.node} ${cathode.node} LED`);
      usedModels.add("LED");
      componentEdges.push({ componentId: component.id, from: anode.node, to: cathode.node });
    } else if (kind === "diode") {
      lines.push(`${elementName("D", component.id)} ${a.node} ${b.node} DIODE`);
      usedModels.add("DIODE");
      componentEdges.push({ componentId: component.id, from: a.node, to: b.node });
    }
  }

  lines.push("");
  if (usedModels.has("LED")) lines.push(".model LED D");
  if (usedModels.has("DIODE")) lines.push(".model DIODE D");
  lines.push("");
  lines.push(".op");
  lines.push("");
  lines.push(".end");

  for (const node of new Set(Array.from(endpointToNet.values()))) {
    if (node !== "0" && node !== "VCC") {
      const connectedComponents = Array.from(componentPins.entries())
        .filter(([, pins]) => Array.from(pins.values()).some((terminal) => terminal.node === node))
        .map(([componentId]) => componentId);

      if (connectedComponents.length < 2) {
        errors.push({
          code: "FLOATING_NODE",
          message: `Electrical node ${node} is not tied to another component or rail.`,
          componentId: connectedComponents[0],
          node,
          details: { node, componentIds: connectedComponents },
        });
      }
    }
  }

  if (hasPower && hasGround && !errors.some((error) => error.code === "SHORT_CIRCUIT")) {
    if (!hasPathBetweenRails(componentEdges)) {
      errors.push({
        code: "OPEN_CIRCUIT",
        message: "Circuit does not contain a complete path between VCC and ground through connected components.",
      });
    }
  }

  return {
    netlist: lines.join("\n"),
    nodeMap: endpointToNet,
    endpointToNet,
    powerVoltage,
    errors,
    warnings,
  };
};

const hasPathBetweenRails = (edges: Array<{ from: string; to: string }>) => {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    const fromEdges = graph.get(edge.from) ?? new Set<string>();
    const toEdges = graph.get(edge.to) ?? new Set<string>();
    fromEdges.add(edge.to);
    toEdges.add(edge.from);
    graph.set(edge.from, fromEdges);
    graph.set(edge.to, toEdges);
  }

  const seen = new Set<string>();
  const queue = ["VCC"];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || seen.has(node)) continue;
    if (node === "0") return true;
    seen.add(node);
    queue.push(...(graph.get(node) ?? []));
  }

  return false;
};

const connectionTypeForEndpoint = (
  request: NgspiceRequest,
  componentId: string | undefined,
  pin: string | undefined,
) => {
  if (!componentId || !pin) return undefined;
  return request.connections.find((connection) =>
    [connection.from, connection.to].some((endpoint) =>
      endpoint.componentId === componentId && netPinLabel(endpoint) === pin,
    ),
  )?.type;
};

const endpointTypeForNetEntry = (request: NgspiceRequest, entry: string) => {
  const [componentId, pin] = entry.split(":");
  return connectionTypeForEndpoint(request, componentId, pin);
};
