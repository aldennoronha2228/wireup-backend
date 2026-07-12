import type { SearchResult } from "./tavily-client";

export interface ComponentRecommendation {
  name: string;
  id: string;
  type: string;
  confidence: number;
  reason: string;
  sources: string[];
  specifications?: Record<string, unknown>;
}

export interface PinMapping {
  component: string;
  pinName: string;
  platformPin: string;
  protocol?: string;
  voltage?: number;
  notes?: string;
}

export interface HardwareContext {
  platform: string;
  components: ComponentRecommendation[];
  libraries: ComponentRecommendation[];
  pinMappings: PinMapping[];
  powerRequirements: {
    voltage: number;
    maxCurrent: number;
  }[];
  communicationProtocols: string[];
  warnings: string[];
  sources: string[];
  rawExtract: string;
}

/**
 * Extract hardware recommendations from search results with confidence scoring.
 */
export function extractTechnicalKnowledge(
  searchResults: SearchResult[][],
): HardwareContext {
  const components = new Map<string, ComponentRecommendation>();
  const libraries = new Map<string, ComponentRecommendation>();
  const pinMappings: PinMapping[] = [];
  const warnings = new Set<string>();
  const sources = new Set<string>();
  const protocols = new Set<string>();

  const powerRequirements: { voltage: number; maxCurrent: number }[] = [];

  // Common sensor patterns
  const sensorPatterns: Record<string, { type: string; confidence: number }> = {
    dht22: { type: "temperature-humidity", confidence: 0.95 },
    dht11: { type: "temperature-humidity", confidence: 0.95 },
    bme280: { type: "pressure-humidity-temperature", confidence: 0.98 },
    bmp280: { type: "pressure-temperature", confidence: 0.98 },
    mpu6050: { type: "accelerometer-gyro", confidence: 0.95 },
    "hc-sr04": { type: "distance", confidence: 0.98 },
    hcsr04: { type: "distance", confidence: 0.98 },
    bh1750: { type: "light", confidence: 0.95 },
    "mq-2": { type: "gas-sensor", confidence: 0.85 },
    mq2: { type: "gas-sensor", confidence: 0.85 },
    "mh-z19": { type: "co2-sensor", confidence: 0.95 },
    ds18b20: { type: "temperature", confidence: 0.98 },
  };

  // Library patterns
  const libraryPatterns: Record<string, string[]> = {
    "DHT": ["temperature", "humidity"],
    "Adafruit_BME280": ["pressure", "humidity", "temperature"],
    "Adafruit_BMP280": ["pressure"],
    "MPU6050": ["accelerometer", "gyro"],
    "Adafruit_VL53L0X": ["distance"],
    "BH1750": ["light"],
    "MicroNMEA": ["gps"],
    "OneWire": ["temperature"],
    "DallasTemperature": ["temperature"],
    "ArduinoJson": ["json"],
    "WiFi": ["network"],
    "AsyncHTTPClient": ["network"],
  };

  let flatText = "";

  // Process all search results
  for (const resultGroup of searchResults) {
    for (const result of resultGroup) {
      flatText += ` ${result.content} `;
      sources.add(result.source);

      // Extract from content
      const content = result.content.toLowerCase();

      // Detect components
      for (const [name, { type, confidence }] of Object.entries(
        sensorPatterns,
      )) {
        if (
          content.includes(name) &&
          !components.has(name)
        ) {
          const sourceList = Array.from(
            new Set(
              searchResults
                .flat()
                .filter((r) => r.content.toLowerCase().includes(name))
                .map((r) => r.source),
            ),
          );

          components.set(name, {
            name: name.toUpperCase(),
            id: `sensor-${name}`,
            type,
            confidence,
            reason: `Found in ${sourceList.length} sources with technical documentation`,
            sources: sourceList,
          });
        }
      }

      // Detect libraries
      for (const [libName, keywords] of Object.entries(libraryPatterns)) {
        if (
          content.includes(libName.toLowerCase()) &&
          !libraries.has(libName)
        ) {
          const matchingKeywords = keywords.filter((kw) =>
            content.includes(kw),
          );
          libraries.set(libName, {
            name: libName,
            id: `lib-${libName}`,
            type: "library",
            confidence: 0.9,
            reason: `Official Arduino/PlatformIO library for ${matchingKeywords.join(", ")}`,
            sources: Array.from(sources),
          });
        }
      }

      // Detect I2C/SPI protocols
      if (
        content.includes("i2c") ||
        content.includes("i²c") ||
        content.includes("twi")
      ) {
        protocols.add("I2C");
      }
      if (content.includes("spi")) {
        protocols.add("SPI");
      }
      if (content.includes("uart") || content.includes("serial")) {
        protocols.add("UART");
      }

      // Extract voltage information
      const voltagePattern = /(\d+\.?\d*)\s*[vV]/g;
      const voltages = content.match(voltagePattern);
      if (voltages) {
        voltages.forEach((v) => {
          const num = parseFloat(v);
          if (num > 0 && num <= 48) {
            // Reasonable range
            if (!powerRequirements.find((p) => p.voltage === num)) {
              powerRequirements.push({ voltage: num, maxCurrent: 500 });
            }
          }
        });
      }

      // Detect warnings
      if (
        content.includes("level shifter") ||
        content.includes("voltage divider")
      ) {
        warnings.add("Voltage level shifting may be required");
      }
      if (content.includes("pull-up") || content.includes("pullup")) {
        warnings.add("Pull-up resistors may be required for I2C/1-wire");
      }
      if (content.includes("decoupling") || content.includes("bypass")) {
        warnings.add("Add decoupling capacitors close to power pins");
      }
    }
  }

  // Build pin mappings from detected protocols
  if (protocols.has("I2C")) {
    pinMappings.push({
      component: "I2C Bus",
      pinName: "SDA",
      platformPin: "GPIO21",
      protocol: "I2C",
      voltage: 3.3,
      notes: "Pull-up resistors to 3.3V may be required",
    });
    pinMappings.push({
      component: "I2C Bus",
      pinName: "SCL",
      platformPin: "GPIO22",
      protocol: "I2C",
      voltage: 3.3,
      notes: "Pull-up resistors to 3.3V may be required",
    });
  }

  if (protocols.has("SPI")) {
    pinMappings.push({
      component: "SPI Bus",
      pinName: "MOSI",
      platformPin: "GPIO23",
      protocol: "SPI",
      voltage: 3.3,
    });
    pinMappings.push({
      component: "SPI Bus",
      pinName: "MISO",
      platformPin: "GPIO19",
      protocol: "SPI",
      voltage: 3.3,
    });
    pinMappings.push({
      component: "SPI Bus",
      pinName: "CLK",
      platformPin: "GPIO18",
      protocol: "SPI",
      voltage: 3.3,
    });
  }

  return {
    platform: "esp32", // Detected from context
    components: Array.from(components.values()),
    libraries: Array.from(libraries.values()),
    pinMappings,
    powerRequirements: powerRequirements.length > 0 ? powerRequirements : [
      { voltage: 3.3, maxCurrent: 500 },
    ],
    communicationProtocols: Array.from(protocols),
    warnings: Array.from(warnings),
    sources: Array.from(sources),
    rawExtract: flatText.slice(0, 5000), // Keep first 5000 chars for reference
  };
}

/**
 * Score the confidence of extracted knowledge.
 */
export function scoreKnowledgeConfidence(context: HardwareContext): number {
  let score = 0.5; // Base score

  if (context.components.length > 0) score += 0.2;
  if (context.libraries.length > 0) score += 0.1;
  if (context.pinMappings.length > 0) score += 0.1;
  if (context.communicationProtocols.length > 0) score += 0.05;
  if (context.powerRequirements.length > 1) score += 0.05;

  return Math.min(score, 1.0);
}
