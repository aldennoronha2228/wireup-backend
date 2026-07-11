interface ParsedResult {
  voltages: Record<string, number>;
  currents: Record<string, number>;
  warnings: string[];
}

const parseNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

export const parseNgspiceOutput = (output: string): ParsedResult => {
  const voltages: Record<string, number> = {};
  const currents: Record<string, number> = {};
  const warnings: string[] = [];

  const lines = output.split("\n");
  let inVoltageSection = false;

  lines.forEach((line) => {
    if (line.toLowerCase().includes("warning")) {
      warnings.push(line.trim());
    }

    if (line.toLowerCase().includes("node voltages")) {
      inVoltageSection = true;
      return;
    }

    if (inVoltageSection) {
      if (line.trim() === "") {
        inVoltageSection = false;
        return;
      }
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[0];
        const value = parseNumber(parts[1]);
        if (value !== null) {
          voltages[name] = value;
        }
      }
    }

    const currentMatch = line.match(/i\(([^)]+)\)\s*=\s*([-+eE0-9\.]+)/);
    if (currentMatch) {
      const value = parseNumber(currentMatch[2]);
      if (value !== null) {
        currents[currentMatch[1]] = value;
      }
    }
  });

  return { voltages, currents, warnings };
};
