import { HardwarePlatformType, type Component, type Sensor } from "@wireup/types";
import type { HardwareContext } from "./knowledge-extractor";

/**
 * Convert extracted hardware context into Components and Sensors
 * that can be used by the Planner.
 */
export function contextToComponents(context: HardwareContext): {
  sensors: Sensor[];
  components: Component[];
  libraries: string[];
} {
  const sensors: Sensor[] = [];
  const components: Component[] = [];
  const libraries = new Set<string>();

  // Convert component recommendations to Sensor objects
  for (const comp of context.components) {
    const pinMapping = context.pinMappings.find(
      (pm) => pm.component === comp.name,
    );

    if (comp.type.includes("temperature") || comp.type.includes("humidity") || comp.type.includes("pressure")) {
      sensors.push({
        id: comp.id,
        name: comp.name,
        type: comp.type,
        description: `${comp.name} sensor (confidence: ${(comp.confidence * 100).toFixed(0)}%)`,
        pins: [
          {
            componentId: comp.id,
            pinName: pinMapping?.pinName || "SDA",
            platformPin: pinMapping?.platformPin || "GPIO21",
          },
        ],
      });
    }

    // Create component
    components.push({
      id: comp.id,
      name: comp.name,
      type: "sensor",
      description: `${comp.name} (${(comp.confidence * 100).toFixed(0)}% confidence) - Sources: ${comp.sources.join(", ")}`,
      specifications: {
        ...comp.specifications,
        confidence: comp.confidence,
        reason: comp.reason,
      },
      quantity: 1,
    });
  }

  // Add library recommendations
  for (const lib of context.libraries) {
    libraries.add(lib.name);

    // Optionally create a component entry for documentation
    components.push({
      id: lib.id,
      name: lib.name,
      type: "other",
      description: `${lib.reason} - Sources: ${lib.sources.slice(0, 3).join(", ")}`,
      specifications: {
        confidence: lib.confidence,
      },
      quantity: 1,
    });
  }

  // Add protocol-based pins
  for (const pinMapping of context.pinMappings) {
    if (!sensors.some((s) => s.id === pinMapping.component)) {
      // Create a virtual component for the protocol
      components.push({
        id: `protocol-${pinMapping.protocol}`,
        name: `${pinMapping.protocol} Bus`,
        type: "other",
        description: `${pinMapping.protocol} communication (${pinMapping.pinName})`,
        specifications: {
          protocol: pinMapping.protocol,
          voltage: pinMapping.voltage,
          notes: pinMapping.notes,
        },
        quantity: 1,
      });
    }
  }

  return {
    sensors,
    components,
    libraries: Array.from(libraries),
  };
}

/**
 * Detect the primary hardware platform from context.
 */
export function detectPlatformFromContext(context: HardwareContext): HardwarePlatformType {
  // Check for platform indicators in sources and components
  const allText = [
    ...context.sources,
    ...context.components.map((c) => c.name),
    context.platform,
  ]
    .join(" ")
    .toLowerCase();

  if (allText.includes("esp32")) return HardwarePlatformType.ESP32;
  if (allText.includes("raspberry")) return HardwarePlatformType.RASPBERRY_PI;
  if (allText.includes("stm32")) return HardwarePlatformType.STM32;
  if (allText.includes("nano")) return HardwarePlatformType.ARDUINO_NANO;

  // Default based on detected protocols
  if (context.communicationProtocols.includes("I2C")) {
    // I2C is common on ESP32 and Raspberry Pi
    return HardwarePlatformType.ESP32;
  }

  return HardwarePlatformType.ARDUINO_UNO;
}

/**
 * Build firmware goals from the detected components.
 */
export function buildFirmwareGoalsFromContext(context: HardwareContext): string[] {
  const goals: string[] = [
    "Initialize hardware interfaces and sensors",
    "Read sensor data at regular intervals",
    "Validate sensor readings for anomalies",
  ];

  if (context.communicationProtocols.includes("I2C")) {
    goals.push("Initialize I2C bus and enumerate devices");
  }

  if (context.communicationProtocols.includes("SPI")) {
    goals.push("Initialize SPI bus with appropriate clock settings");
  }

  if (context.libraries.some((lib) => lib.name.includes("WiFi"))) {
    goals.push("Connect to WiFi network and handle reconnection");
  }

  if (context.components.some((comp) => comp.type.includes("temperature"))) {
    goals.push("Sample temperature readings and apply smoothing");
  }

  if (context.warnings.length > 0) {
    goals.push("Handle electrical constraints mentioned in warnings");
  }

  return goals;
}

/**
 * Build confidence explanation for the plan.
 */
export function buildConfidenceExplanation(
  context: HardwareContext,
  confidence: number,
): string {
  const factors: string[] = [];

  if (context.components.length > 0) {
    factors.push(`${context.components.length} hardware components identified`);
  }
  if (context.libraries.length > 0) {
    factors.push(`${context.libraries.length} libraries recommended`);
  }
  if (context.communicationProtocols.length > 0) {
    factors.push(
      `Communication protocols: ${context.communicationProtocols.join(", ")}`,
    );
  }
  if (context.sources.length > 0) {
    factors.push(`Information from ${context.sources.length} sources`);
  }

  if (context.warnings.length > 0) {
    factors.push(
      `Note: ${context.warnings.length} design considerations identified`,
    );
  }

  return [
    `Confidence Score: ${(confidence * 100).toFixed(0)}%`,
    "",
    "Based on:",
    ...factors.map((f) => `- ${f}`),
  ].join("\n");
}
