import type { NgspiceRequest } from "./schema.js";

interface Issue {
  code: string;
  message: string;
  componentId?: string;
  pinName?: string;
  node?: string;
  details?: Record<string, unknown>;
}

const parseNumeric = (value: unknown): number | null => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const match = value.match(/([0-9]+(\.[0-9]+)?)/);
    if (match) return Number(match[1]);
  }
  return null;
};

export const analyzeCircuit = (
  request: NgspiceRequest,
  ngspiceOutput: string,
  voltages: Record<string, number>,
  currents: Record<string, number>,
) => {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const suggestedFixes: string[] = [];

  if (ngspiceOutput.toLowerCase().includes("singular matrix")) {
    const nodeMatch = ngspiceOutput.match(/singular matrix:\s*check node\s+([^\s]+)/i);
    const node = nodeMatch?.[1];
    errors.push({
      code: "OPEN_CIRCUIT",
      message: node
        ? `Open circuit detected by ngspice near node ${node}.`
        : "Open circuit detected by ngspice.",
      node,
      details: { node },
    });
    suggestedFixes.push("Check continuity across all nets.");
  }

  const componentVoltages = request.components
    .map((component) => parseNumeric(component.specifications?.voltage))
    .filter((value): value is number => value !== null);

  const uniqueVoltages = Array.from(new Set(componentVoltages));
  if (uniqueVoltages.length > 1) {
    warnings.push({
      code: "POWER_RAIL_CONFLICT",
      message: "Multiple voltage levels detected in components",
      details: { voltages: uniqueVoltages },
    });
    suggestedFixes.push("Ensure all components share compatible voltage rails.");
  }

  if (request.board.voltage) {
    request.components.forEach((component) => {
      const maxVoltage = parseNumeric(component.specifications?.voltage);
      if (maxVoltage && request.board.voltage && request.board.voltage > maxVoltage) {
        errors.push({
          code: "INVALID_VOLTAGE",
          message: `Voltage exceeds rating for ${component.name}`,
          details: { componentId: component.id, maxVoltage, boardVoltage: request.board.voltage },
        });
      }
    });
  }

  request.components.forEach((component) => {
    const resistance = component.specifications?.resistance;
    if (resistance !== undefined && parseNumeric(resistance) === null) {
      warnings.push({
        code: "INVALID_COMPONENT_VALUE",
        message: `Invalid resistance value on ${component.name}`,
        details: { componentId: component.id, resistance },
      });
    }
    const capacitance = component.specifications?.capacitance;
    if (capacitance !== undefined && parseNumeric(capacitance) === null) {
      warnings.push({
        code: "INVALID_COMPONENT_VALUE",
        message: `Invalid capacitance value on ${component.name}`,
        details: { componentId: component.id, capacitance },
      });
    }
  });

  const i2cComponents = request.components.filter(
    (component) =>
      String(component.specifications?.interface || "").toLowerCase() === "i2c",
  );
  const hasResistor = request.components.some((component) =>
    component.name.toLowerCase().includes("resistor"),
  );

  if (i2cComponents.length > 0 && !hasResistor) {
    warnings.push({
      code: "MISSING_PULLUPS",
      message: "Missing pull-up resistors for I2C bus",
      details: { components: i2cComponents.map((component) => component.id) },
    });
    suggestedFixes.push("Add pull-up resistors on SDA/SCL lines.");
  }

  const maxCurrent = request.components
    .map((component) => parseNumeric(component.specifications?.maxCurrent))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)[0];

  const supplyCurrent = currents["V_VCC"] || currents["v_vcc"] || 0;
  if (maxCurrent && Math.abs(supplyCurrent) > maxCurrent) {
    errors.push({
      code: "CURRENT_OVERLOAD",
      message: "Supply current exceeds component maximum",
      details: { maxCurrent, supplyCurrent },
    });
    suggestedFixes.push("Reduce load or use a higher-rated power supply.");
  }

  return { errors, warnings, suggestedFixes };
};
