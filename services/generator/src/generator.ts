import {
  HardwarePlatformType,
  type AssemblyInstruction,
  type Component,
  type Firmware,
  type GeneratorResponse,
  type PlannerResponse,
  type ProjectMetadata,
  type SimulationComponent,
  type SimulationConnection,
  type WiringMetadata,
} from "@wireup/types";

const firmwareLanguage = (platform: HardwarePlatformType) =>
  platform === HardwarePlatformType.RASPBERRY_PI ? "python" : "arduino";

const buildFirmware = (plan: PlannerResponse): Firmware => {
  const language = firmwareLanguage(plan.hardwarePlatform.type);
  const libraryIncludes = plan.libraries
    .filter(Boolean)
    .map((library) => (language === "python" ? `import ${library}` : `#include <${library}.h>`));

  const pinSetupLines = plan.wiring.connections.map((connection) =>
    language === "python"
      ? `# configure ${connection.from.platformPin}`
      : `pinMode(${connection.from.platformPin}, ${
          connection.type === "analog" ? "INPUT" : "INPUT_PULLUP"
        });`,
  );

  const readLines = plan.wiring.connections.map((connection, index) =>
    language === "python"
      ? `value_${index} = read_${connection.from.platformPin}()`
      : `auto value_${index} = ${
          connection.type === "analog" ? "analogRead" : "digitalRead"
        }(${connection.from.platformPin});`,
  );

  if (language === "python") {
    return {
      language,
      code: [
        "# Firmware skeleton",
        ...libraryIncludes,
        "",
        "def setup():",
        ...pinSetupLines.map((line) => `    ${line}`),
        "",
        "def loop():",
        ...readLines.map((line) => `    ${line}`),
        "    return",
      ].join("\n"),
      libraries: plan.libraries,
    };
  }

  return {
    language,
    code: [
      "// Firmware skeleton",
      ...libraryIncludes,
      "",
      "void setup() {",
      ...pinSetupLines.map((line) => `  ${line}`),
      "}",
      "",
      "void loop() {",
      ...readLines.map((line) => `  ${line}`),
      "  delay(500);",
      "}",
    ].join("\n"),
    libraries: plan.libraries,
  };
};

const buildProjectMetadata = (plan: PlannerResponse): ProjectMetadata => {
  const titleSeed = plan.projectRequirements[0] || plan.hardwarePlatform.name;
  return {
    title: `${plan.hardwarePlatform.name} ${titleSeed}`.trim(),
    description: plan.projectRequirements.join(" "),
    tags: [plan.hardwarePlatform.type, ...plan.libraries].filter(Boolean),
    difficulty: "beginner",
  };
};

const buildAssemblyInstructions = (plan: PlannerResponse): AssemblyInstruction[] => {
  const instructions: AssemblyInstruction[] = [];
  const powerNote = "Connect all components to common power and ground rails.";

  instructions.push({
    step: 1,
    title: "Prepare power rails",
    description: powerNote,
  });

  plan.wiring.connections.forEach((connection, index) => {
    instructions.push({
      step: index + 2,
      title: `Wire ${connection.from.componentId} to ${connection.from.platformPin}`,
      description: `Connect ${connection.from.pinName} to ${connection.from.platformPin} as ${connection.type}.`,
    });
  });

  return instructions;
};

const buildWiringMetadata = (plan: PlannerResponse): WiringMetadata => {
  const pinUsage: Record<string, string[]> = {};

  plan.wiring.connections.forEach((connection) => {
    const pin = connection.from.platformPin;
    if (!pinUsage[pin]) pinUsage[pin] = [];
    pinUsage[pin].push(connection.from.componentId);
  });

  return {
    totalConnections: plan.wiring.connections.length,
    analogConnections: plan.wiring.connections.filter((c) => c.type === "analog").length,
    digitalConnections: plan.wiring.connections.filter((c) => c.type === "digital").length,
    powerConnections: plan.wiring.connections.filter((c) => c.type === "power").length,
    groundConnections: plan.wiring.connections.filter((c) => c.type === "ground").length,
    pinUsage,
  };
};

const buildSimulation = (plan: PlannerResponse) => {
  const components: SimulationComponent[] = plan.requiredComponents.map(
    (component, index) => ({
      id: component.id,
      type: component.type,
      properties: component.specifications,
      position: { x: index * 40, y: 0 },
    }),
  );

  const connections: SimulationConnection[] = plan.wiring.connections.map(
    (connection) => ({
      from: {
        componentId: connection.from.componentId,
        pin: connection.from.pinName,
      },
      to: {
        componentId: connection.to.componentId,
        pin: connection.to.pinName,
      },
    }),
  );

  return {
    version: "1.0",
    components,
    connections,
    setup: {
      timeStep: 10,
      duration: plan.simulationRequirements.duration,
    },
  };
};

export const buildGeneratorOutput = (plan: PlannerResponse): GeneratorResponse => {
  const firmware = buildFirmware(plan);
  const componentList: Component[] = plan.requiredComponents.map((component) => ({
    ...component,
    quantity: component.quantity || 1,
  }));

  return {
    firmware,
    wiring: plan.wiringPlan,
    componentList,
    assemblyInstructions: buildAssemblyInstructions(plan),
    projectMetadata: buildProjectMetadata(plan),
    wiringMetadata: buildWiringMetadata(plan),
    simulationJson: buildSimulation(plan),
  };
};
