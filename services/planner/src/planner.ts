import {
  HardwarePlatformType,
  type Component,
  type HardwarePlatform,
  type PinAssignment,
  type PlannerResponse,
  type RagContextItem,
  type Sensor,
  type WiringPlan,
} from "@wireup/types";
import {
  createRetrievalService,
  type RetrievalService,
} from "./retrieval/index";
import {
  contextToComponents,
  detectPlatformFromContext,
  buildFirmwareGoalsFromContext,
  buildConfidenceExplanation,
} from "./retrieval/context-builder";

export interface PlannerInputs {
  prompt: string;
  ragContext: RagContextItem[];
  projectState?: Record<string, unknown>;
  useRetrieval?: boolean;
}

const platformNames: Record<HardwarePlatformType, string> = {
  [HardwarePlatformType.ARDUINO_UNO]: "Arduino Uno",
  [HardwarePlatformType.ARDUINO_NANO]: "Arduino Nano",
  [HardwarePlatformType.ESP32]: "ESP32",
  [HardwarePlatformType.RASPBERRY_PI]: "Raspberry Pi",
  [HardwarePlatformType.STM32]: "STM32",
};


const createPlatformAssignment = (pin: string): PinAssignment => ({
  componentId: "platform",
  pinName: pin,
  platformPin: pin,
});

const mergeExistingComponents = (
  base: Component[],
  projectState?: Record<string, unknown>,
) => {
  const existing = Array.isArray(projectState?.requiredComponents)
    ? (projectState?.requiredComponents as Component[])
    : [];

  const merged = new Map<string, Component>();
  [...existing, ...base].forEach((component) => {
    merged.set(component.id, component);
  });

  return Array.from(merged.values());
};

/**
 * Build a plan using retrieval-first approach.
 * First retrieves technical information, then generates the plan.
 */
export async function buildPlanWithRetrieval(
  inputs: PlannerInputs,
  retrieverService?: RetrievalService,
): Promise<PlannerResponse> {
  const service =
    retrieverService ||
    createRetrievalService({
      enabled: inputs.useRetrieval !== false,
    });

  console.log(
    `[Planner] Starting retrieval-first planning for: "${inputs.prompt.slice(0, 50)}..."`,
  );

  // Execute retrieval pipeline
  const retrievalResult = await service.retrieve(inputs.prompt);

  if (!retrievalResult.success && retrievalResult.error) {
    console.warn(
      `[Planner] Retrieval failed, falling back to knowledge base: ${retrievalResult.error}`,
    );
  }

  // Convert retrieval context to components and sensors
  const { sensors: retrievedSensors, components: retrievedComponents, libraries: retrievedLibraries } =
    retrievalResult.success
      ? contextToComponents(retrievalResult.context)
      : { sensors: [], components: [], libraries: [] };

  // Detect platform from retrieved context
  const platformType = retrievalResult.success
    ? detectPlatformFromContext(retrievalResult.context)
    : HardwarePlatformType.ESP32;

  const hardwarePlatform: HardwarePlatform = {
    type: platformType,
    name: platformNames[platformType],
    pinout: basePinouts[platformType],
  };

  const requirements = inputs.prompt
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  // Merge with existing components
  const allComponents = mergeExistingComponents(
    [...retrievedComponents],
    inputs.projectState,
  );

  // Use retrieved sensors or generate default if needed
  const sensors = retrievedSensors.length > 0 ? retrievedSensors : [];

  if (sensors.length === 0) {
    console.warn(
      "[Planner] No sensors found via retrieval; prompt may need clarification",
    );
  }

  // Assign pins
  const neededPins = sensors.reduce(
    (sum, sensor) => sum + sensor.pins.length,
    0,
  );
  const availablePins = hardwarePlatform.pinout;
  const assignedPins = availablePins
    .slice(0, Math.max(neededPins, 4))
    .map((pin) => pin.pinNumber);

  let pinIndex = 0;
  sensors.forEach((sensor) => {
    sensor.pins = sensor.pins.map((pin) => ({
      ...pin,
      platformPin: assignedPins[pinIndex++] || availablePins[0].pinNumber,
    }));
  });

  // Build wiring plan from sensors
  const wiringPlan: WiringPlan = {
    connections: sensors.flatMap((sensor) =>
      sensor.pins.map((pin) => ({
        from: pin,
        to: createPlatformAssignment(pin.platformPin),
        type: pin.pinName.toUpperCase().includes("A") ? "analog" : "digital",
      })),
    ),
    notes: [
      "All components share common power and ground rails",
      retrievalResult.context.warnings.length > 0
        ? `Design considerations: ${retrievalResult.context.warnings.join("; ")}`
        : "Use stable power supply with adequate filtering",
      ...retrievalResult.context.pinMappings
        .filter((pm) => pm.notes)
        .map((pm) => pm.notes || ""),
    ].filter(Boolean),
  };

  // Build firmware goals from context
  const firmwareGoals = buildFirmwareGoalsFromContext(retrievalResult.context);

  // Combine libraries
  const allLibraries = new Set<string>([
    ...retrievedLibraries,
    ...retrievalResult.context.libraries.map((lib) => lib.name),
  ]);

  // Build confidence explanation as a project requirement note
  const confidenceNote = buildConfidenceExplanation(
    retrievalResult.context,
    retrievalResult.confidence,
  );

  return {
    projectRequirements: [
      ...requirements.filter(Boolean),
      ...(retrievalResult.success
        ? [
          `[Retrieval Sources: ${retrievalResult.context.sources.join(", ")}]`,
          confidenceNote,
        ]
        : []),
    ],
    hardwarePlatform,
    sensors,
    firmwareGoals,
    requiredComponents: allComponents,
    wiringPlan,
    wiringStrategy:
      sensors.length > 0
        ? `Each sensor is wired to a unique GPIO pin. ${retrievalResult.context.communicationProtocols.includes("I2C") ? "I2C protocol is used for multi-device communication." : "Digital pins are configured with appropriate pull-ups as needed."}`.trim()
        : "Unable to determine wiring strategy; insufficient information found",
    libraries: Array.from(allLibraries),
    simulationRequirements: {
      duration: 10000,
      inputSignals:
        sensors.map((s) => ({
          pin: s.pins[0]?.platformPin ?? "",
          type: s.pins[0]?.pinName.toUpperCase().includes("A") ? "analog" as const : "digital" as const,
          values: [],
          intervalMs: 1000,
        })) || [],
      expectedOutputs: allComponents
        .filter((c) => c.type === "actuator")
        .map((c) => {
          const rawPin = (c.specifications as Record<string, unknown>)?.pin;
          const pin = typeof rawPin === "string" ? rawPin : "";
          return {
            pin,
            type: "digital" as const,
            expectedValues: undefined,
            min: undefined,
            max: undefined,
          };
        }) || [],
    },
  };
}

/**
 * Legacy synchronous planner for backward compatibility.
 * Use buildPlanWithRetrieval for new code.
 */
export const buildPlan = (inputs: PlannerInputs): PlannerResponse => {
  // Note: This is a synchronous stub. In practice, use buildPlanWithRetrieval
  console.warn(
    "[Planner] buildPlan called synchronously; retrieval is disabled",
  );

  const platformType = HardwarePlatformType.ESP32;
  const hardwarePlatform: HardwarePlatform = {
    type: platformType,
    name: platformNames[platformType],
    pinout: basePinouts[platformType],
  };

  const requirements = inputs.prompt
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  return {
    projectRequirements: [
      ...requirements,
      "[WARNING: Retrieval disabled; using knowledge base only]",
    ],
    hardwarePlatform,
    sensors: [],
    firmwareGoals: [
      "Initialize hardware interfaces",
      "Read sensor data at regular intervals",
      "Validate sensor readings",
    ],
    requiredComponents: [],
    wiringPlan: {
      connections: [],
      notes: [
        "Retrieval disabled; manually add components and wiring information",
      ],
    },
    wiringStrategy:
      "Unable to determine; retrieval is disabled",
    libraries: [],
    simulationRequirements: {
      duration: 10000,
      inputSignals: [],
      expectedOutputs: [],
    },
  };
};


const basePinouts: Record<HardwarePlatformType, HardwarePlatform["pinout"]> = {
  [HardwarePlatformType.ARDUINO_UNO]: [
    { pinNumber: "D2", function: "GPIO", voltage: 5 },
    { pinNumber: "D3", function: "GPIO", voltage: 5 },
    { pinNumber: "D4", function: "GPIO", voltage: 5 },
    { pinNumber: "A0", function: "ADC", voltage: 5 },
  ],
  [HardwarePlatformType.ARDUINO_NANO]: [
    { pinNumber: "D2", function: "GPIO", voltage: 5 },
    { pinNumber: "D3", function: "GPIO", voltage: 5 },
    { pinNumber: "D4", function: "GPIO", voltage: 5 },
    { pinNumber: "A0", function: "ADC", voltage: 5 },
  ],
  [HardwarePlatformType.ESP32]: [
    { pinNumber: "GPIO2", function: "GPIO", voltage: 3.3 },
    { pinNumber: "GPIO4", function: "GPIO", voltage: 3.3 },
    { pinNumber: "GPIO5", function: "GPIO", voltage: 3.3 },
    { pinNumber: "GPIO34", function: "ADC", voltage: 3.3 },
  ],
  [HardwarePlatformType.RASPBERRY_PI]: [
    { pinNumber: "GPIO17", function: "GPIO", voltage: 3.3 },
    { pinNumber: "GPIO27", function: "GPIO", voltage: 3.3 },
    { pinNumber: "GPIO22", function: "GPIO", voltage: 3.3 },
    { pinNumber: "GPIO23", function: "GPIO", voltage: 3.3 },
  ],
  [HardwarePlatformType.STM32]: [
    { pinNumber: "PA0", function: "ADC", voltage: 3.3 },
    { pinNumber: "PA1", function: "GPIO", voltage: 3.3 },
    { pinNumber: "PB0", function: "GPIO", voltage: 3.3 },
    { pinNumber: "PB1", function: "GPIO", voltage: 3.3 },
  ],
};

