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
  let inCurrentSection = false;
  let currentRowsSeen = false;

  lines.forEach((line) => {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (line.toLowerCase().includes("warning")) {
      warnings.push(trimmed);
    }

    if (lower.includes("node voltages") || (lower.startsWith("node") && lower.includes("voltage"))) {
      inVoltageSection = true;
      inCurrentSection = false;
      return;
    }

    if (lower.startsWith("source") && lower.includes("current")) {
      inCurrentSection = true;
      inVoltageSection = false;
      currentRowsSeen = false;
      return;
    }

    if (inVoltageSection) {
      if (trimmed === "") {
        inVoltageSection = false;
        return;
      }

      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[0];
        const value = parseNumber(parts[1]);
        if (value !== null && name !== "----") {
          voltages[name] = value;
        }
      }
    }

    if (inCurrentSection) {
      if (trimmed === "") {
        if (currentRowsSeen) inCurrentSection = false;
        return;
      }

      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[0];
        const value = parseNumber(parts[1]);
        if (value !== null && name !== "------") {
          currents[name] = value;
          if (name.toLowerCase().endsWith("#branch")) {
            currents[name.replace(/#branch$/i, "")] = value;
          }
          currentRowsSeen = true;
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
