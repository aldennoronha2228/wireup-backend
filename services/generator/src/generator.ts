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
  type SimulationJson,
  type WiringMetadata,
} from "@wireup/types";

const firmwareLanguage = (platform: HardwarePlatformType) =>
  platform === HardwarePlatformType.RASPBERRY_PI ? "python" : "arduino";

const assertValue = <T>(value: T | null | undefined, message: string): T => {
  if (value === null || value === undefined) {
    throw new Error(message);
  }

  return value;
};

const getPlannerContext = (plan: PlannerResponse) => {
  const hardwarePlatform = assertValue(
    plan.hardwarePlatform,
    "PlannerResponse is missing hardwarePlatform",
  );
  const simulationRequirements = assertValue(
    plan.simulationRequirements,
    "PlannerResponse is missing simulationRequirements",
  );
  const requiredComponents = assertValue(
    plan.requiredComponents,
    "PlannerResponse is missing requiredComponents",
  );
  const projectRequirements = assertValue(
    plan.projectRequirements,
    "PlannerResponse is missing projectRequirements",
  );
  const libraries = assertValue(plan.libraries, "PlannerResponse is missing libraries");
  const wiringPlan = assertValue(plan.wiringPlan, "PlannerResponse is missing wiringPlan");

  if (!Array.isArray(wiringPlan.connections)) {
    throw new Error("PlannerResponse wiringPlan has no connections");
  }

  return {
    hardwarePlatform,
    simulationRequirements,
    requiredComponents,
    projectRequirements,
    libraries,
    wiringPlan,
    connections: wiringPlan.connections,
  };
};

const buildFirmware = (plan: PlannerResponse): Firmware => {
  const { hardwarePlatform, libraries, connections } = getPlannerContext(plan);
  const language = firmwareLanguage(hardwarePlatform.type);
  const libraryIncludes = libraries
    .filter(Boolean)
    .map((library) => (language === "python" ? `import ${library}` : `#include <${library}.h>`));

  const pinSetupLines = connections.map(
    (connection: PlannerResponse["wiringPlan"]["connections"][number]) =>
      language === "python"
        ? `# configure ${connection.from.platformPin}`
        : `pinMode(${connection.from.platformPin}, ${
            connection.type === "analog" ? "INPUT" : "INPUT_PULLUP"
          });`,
  );

  const readLines = connections.map(
    (connection: PlannerResponse["wiringPlan"]["connections"][number], index: number) =>
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
        ...pinSetupLines.map((line: string) => `    ${line}`),
        "",
        "def loop():",
        ...readLines.map((line: string) => `    ${line}`),
        "    return",
      ].join("\n"),
      libraries,
    };
  }

  return {
    language,
    code: [
      "// Firmware skeleton",
      ...libraryIncludes,
      "",
      "void setup() {",
      ...pinSetupLines.map((line: string) => `  ${line}`),
      "}",
      "",
      "void loop() {",
      ...readLines.map((line: string) => `  ${line}`),
      "  delay(500);",
      "}",
    ].join("\n"),
    libraries,
  };
};

const buildProjectMetadata = (plan: PlannerResponse): ProjectMetadata => {
  const { hardwarePlatform, projectRequirements, libraries } = getPlannerContext(plan);
  const titleSeed = projectRequirements[0] || hardwarePlatform.name;
  return {
    title: `${hardwarePlatform.name} ${titleSeed}`.trim(),
    description: projectRequirements.join(" "),
    tags: [hardwarePlatform.type, ...libraries].filter(Boolean),
    difficulty: "beginner",
  };
};

const buildAssemblyInstructions = (plan: PlannerResponse): AssemblyInstruction[] => {
  const { connections } = getPlannerContext(plan);
  const instructions: AssemblyInstruction[] = [];
  const powerNote = "Connect all components to common power and ground rails.";

  instructions.push({
    step: 1,
    title: "Prepare power rails",
    description: powerNote,
  });

  connections.forEach((connection, index) => {
    instructions.push({
      step: index + 2,
      title: `Wire ${connection.from.componentId} to ${connection.from.platformPin}`,
      description: `Connect ${connection.from.pinName} to ${connection.from.platformPin} as ${connection.type}.`,
    });
  });

  return instructions;
};

const buildWiringMetadata = (plan: PlannerResponse): WiringMetadata => {
  const { connections } = getPlannerContext(plan);
  const pinUsage: Record<string, string[]> = {};

  connections.forEach((connection) => {
    const pin = connection.from.platformPin;
    if (!pinUsage[pin]) pinUsage[pin] = [];
    pinUsage[pin].push(connection.from.componentId);
  });

  return {
    totalConnections: connections.length,
    analogConnections: connections.filter((c) => c.type === "analog").length,
    digitalConnections: connections.filter((c) => c.type === "digital").length,
    powerConnections: connections.filter((c) => c.type === "power").length,
    groundConnections: connections.filter((c) => c.type === "ground").length,
    pinUsage,
  };
};

const buildSimulationJson = (plan: PlannerResponse): SimulationJson => {
  const { requiredComponents, connections, simulationRequirements } = getPlannerContext(plan);

  const components: SimulationComponent[] = requiredComponents.map(
    (component, index) => ({
      id: component.id,
      type: component.type,
      properties: component.specifications,
      position: { x: index * 40, y: 0 },
    }),
  );

  const simulationConnections: SimulationConnection[] = connections.map((connection) => ({
    from: {
      componentId: connection.from.componentId,
      pin: connection.from.pinName,
    },
    to: {
      componentId: connection.to.componentId,
      pin: connection.to.pinName,
    },
  }));

  return {
    version: "1.0",
    components,
    connections: simulationConnections,
    setup: {
      timeStep: 10,
      duration: simulationRequirements.duration,
    },
  };
};

export const buildGeneratorOutput = (plan: PlannerResponse): GeneratorResponse => {
  const { requiredComponents, wiringPlan } = getPlannerContext(plan);
  const firmware = buildFirmware(plan);
  const componentList: Component[] = requiredComponents.map((component) => ({
    ...component,
    quantity: component.quantity || 1,
  }));

  return {
    firmware,
    wiring: wiringPlan,
    componentList,
    assemblyInstructions: buildAssemblyInstructions(plan),
    projectMetadata: buildProjectMetadata(plan),
    wiringMetadata: buildWiringMetadata(plan),
    simulationJson: buildSimulationJson(plan),
  };
};
