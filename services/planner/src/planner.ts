import {
  HardwarePlatformType,
  type Component,
  type Connection,
  type HardwarePlatform,
  type PlannerResponse,
  type RagContextItem,
  type Sensor,
  type WiringPlan,
} from "@wireup/types";
import {
  createRetrievalService,
  type RetrievalResult,
  type RetrievalService,
} from "./retrieval/index";
import type { HardwareContext } from "./retrieval/knowledge-extractor";

export interface PlannerInputs {
  prompt: string;
  ragContext: RagContextItem[];
  projectState?: Record<string, unknown>;
  useRetrieval?: boolean;
}

type Protocol = "digital" | "analog" | "i2c" | "spi" | "uart" | "onewire";
type SimulationKind =
  | "temperature"
  | "pressure"
  | "distance"
  | "motion"
  | "light"
  | "gas"
  | "binary"
  | "output";

interface ComponentTemplate {
  aliases: string[];
  name: string;
  type: Component["type"];
  category: string;
  description: string;
  pins: string[];
  protocol: Protocol;
  voltage: number | "3.3-5";
  libraries: string[];
  simulation: SimulationKind;
  specifications: Record<string, unknown>;
}

interface PromptUnderstanding {
  platform: HardwarePlatformType;
  platformSpecified: boolean;
  components: ComponentTemplate[];
  powerSource?: string;
  connectivity: string[];
  goals: string[];
  controlLogic: string[];
}

const platformNames: Record<HardwarePlatformType, string> = {
  [HardwarePlatformType.ARDUINO_UNO]: "Arduino Uno",
  [HardwarePlatformType.ARDUINO_NANO]: "Arduino Nano",
  [HardwarePlatformType.ESP32]: "ESP32",
  [HardwarePlatformType.RASPBERRY_PI]: "Raspberry Pi",
  [HardwarePlatformType.STM32]: "STM32",
};

const basePinouts: Record<HardwarePlatformType, HardwarePlatform["pinout"]> = {
  [HardwarePlatformType.ARDUINO_UNO]: [
    { pinNumber: "D2", function: "GPIO interrupt", voltage: 5 },
    { pinNumber: "D3", function: "GPIO PWM interrupt", voltage: 5 },
    { pinNumber: "D4", function: "GPIO", voltage: 5 },
    { pinNumber: "D5", function: "GPIO PWM", voltage: 5 },
    { pinNumber: "D6", function: "GPIO PWM", voltage: 5 },
    { pinNumber: "D7", function: "GPIO", voltage: 5 },
    { pinNumber: "D8", function: "GPIO", voltage: 5 },
    { pinNumber: "D9", function: "GPIO PWM", voltage: 5 },
    { pinNumber: "D10", function: "SPI CS PWM", voltage: 5 },
    { pinNumber: "D11", function: "SPI MOSI PWM", voltage: 5 },
    { pinNumber: "D12", function: "SPI MISO", voltage: 5 },
    { pinNumber: "D13", function: "SPI SCK LED", voltage: 5 },
    { pinNumber: "A0", function: "ADC", voltage: 5 },
    { pinNumber: "A1", function: "ADC", voltage: 5 },
    { pinNumber: "A2", function: "ADC", voltage: 5 },
    { pinNumber: "A3", function: "ADC", voltage: 5 },
    { pinNumber: "A4", function: "ADC I2C SDA", voltage: 5 },
    { pinNumber: "A5", function: "ADC I2C SCL", voltage: 5 },
  ],
  [HardwarePlatformType.ARDUINO_NANO]: [
    { pinNumber: "D2", function: "GPIO interrupt", voltage: 5 },
    { pinNumber: "D3", function: "GPIO PWM interrupt", voltage: 5 },
    { pinNumber: "D4", function: "GPIO", voltage: 5 },
    { pinNumber: "D5", function: "GPIO PWM", voltage: 5 },
    { pinNumber: "D6", function: "GPIO PWM", voltage: 5 },
    { pinNumber: "D7", function: "GPIO", voltage: 5 },
    { pinNumber: "D8", function: "GPIO", voltage: 5 },
    { pinNumber: "D9", function: "GPIO PWM", voltage: 5 },
    { pinNumber: "D10", function: "SPI CS PWM", voltage: 5 },
    { pinNumber: "D11", function: "SPI MOSI PWM", voltage: 5 },
    { pinNumber: "D12", function: "SPI MISO", voltage: 5 },
    { pinNumber: "D13", function: "SPI SCK LED", voltage: 5 },
    { pinNumber: "A0", function: "ADC", voltage: 5 },
    { pinNumber: "A1", function: "ADC", voltage: 5 },
    { pinNumber: "A2", function: "ADC", voltage: 5 },
    { pinNumber: "A3", function: "ADC", voltage: 5 },
    { pinNumber: "A4", function: "ADC I2C SDA", voltage: 5 },
    { pinNumber: "A5", function: "ADC I2C SCL", voltage: 5 },
  ],
  [HardwarePlatformType.ESP32]: [
    { pinNumber: "GPIO4", function: "GPIO ADC", voltage: 3.3 },
    { pinNumber: "GPIO5", function: "GPIO SPI CS", voltage: 3.3 },
    { pinNumber: "GPIO13", function: "GPIO ADC", voltage: 3.3 },
    { pinNumber: "GPIO14", function: "GPIO ADC SPI SCK", voltage: 3.3 },
    { pinNumber: "GPIO16", function: "GPIO UART RX", voltage: 3.3 },
    { pinNumber: "GPIO17", function: "GPIO UART TX", voltage: 3.3 },
    { pinNumber: "GPIO18", function: "GPIO SPI SCK", voltage: 3.3 },
    { pinNumber: "GPIO19", function: "GPIO SPI MISO", voltage: 3.3 },
    { pinNumber: "GPIO21", function: "GPIO I2C SDA", voltage: 3.3 },
    { pinNumber: "GPIO22", function: "GPIO I2C SCL", voltage: 3.3 },
    { pinNumber: "GPIO23", function: "GPIO SPI MOSI", voltage: 3.3 },
    { pinNumber: "GPIO25", function: "GPIO DAC ADC", voltage: 3.3 },
    { pinNumber: "GPIO26", function: "GPIO DAC ADC", voltage: 3.3 },
    { pinNumber: "GPIO27", function: "GPIO ADC", voltage: 3.3 },
    { pinNumber: "GPIO32", function: "GPIO ADC", voltage: 3.3 },
    { pinNumber: "GPIO33", function: "GPIO ADC", voltage: 3.3 },
    { pinNumber: "GPIO34", function: "ADC input only", voltage: 3.3 },
    { pinNumber: "GPIO35", function: "ADC input only", voltage: 3.3 },
  ],
  [HardwarePlatformType.RASPBERRY_PI]: [
    { pinNumber: "GPIO2", function: "I2C SDA", voltage: 3.3 },
    { pinNumber: "GPIO3", function: "I2C SCL", voltage: 3.3 },
    { pinNumber: "GPIO4", function: "GPIO", voltage: 3.3 },
    { pinNumber: "GPIO8", function: "SPI CE0", voltage: 3.3 },
    { pinNumber: "GPIO9", function: "SPI MISO", voltage: 3.3 },
    { pinNumber: "GPIO10", function: "SPI MOSI", voltage: 3.3 },
    { pinNumber: "GPIO11", function: "SPI SCLK", voltage: 3.3 },
    { pinNumber: "GPIO14", function: "UART TX", voltage: 3.3 },
    { pinNumber: "GPIO15", function: "UART RX", voltage: 3.3 },
    { pinNumber: "GPIO17", function: "GPIO", voltage: 3.3 },
    { pinNumber: "GPIO18", function: "GPIO PWM", voltage: 3.3 },
    { pinNumber: "GPIO22", function: "GPIO", voltage: 3.3 },
    { pinNumber: "GPIO23", function: "GPIO", voltage: 3.3 },
    { pinNumber: "GPIO24", function: "GPIO", voltage: 3.3 },
    { pinNumber: "GPIO27", function: "GPIO", voltage: 3.3 },
  ],
  [HardwarePlatformType.STM32]: [
    { pinNumber: "PA0", function: "ADC GPIO", voltage: 3.3 },
    { pinNumber: "PA1", function: "ADC GPIO", voltage: 3.3 },
    { pinNumber: "PA2", function: "UART TX GPIO", voltage: 3.3 },
    { pinNumber: "PA3", function: "UART RX GPIO", voltage: 3.3 },
    { pinNumber: "PA4", function: "SPI NSS GPIO", voltage: 3.3 },
    { pinNumber: "PA5", function: "SPI SCK GPIO", voltage: 3.3 },
    { pinNumber: "PA6", function: "SPI MISO GPIO", voltage: 3.3 },
    { pinNumber: "PA7", function: "SPI MOSI GPIO", voltage: 3.3 },
    { pinNumber: "PB0", function: "ADC GPIO", voltage: 3.3 },
    { pinNumber: "PB1", function: "ADC GPIO", voltage: 3.3 },
    { pinNumber: "PB6", function: "I2C SCL GPIO", voltage: 3.3 },
    { pinNumber: "PB7", function: "I2C SDA GPIO", voltage: 3.3 },
  ],
};

const componentCatalog: ComponentTemplate[] = [
  ["DHT22", "temperature-humidity-sensor", "Digital temperature and humidity sensor.", ["VCC", "DATA", "GND"], "digital", "3.3-5", ["DHT", "Adafruit Unified Sensor"], "temperature", ["dht22", "am2302"], { temperatureRangeC: "-40 to 80", humidityRangePercent: "0 to 100" }],
  ["DHT11", "temperature-humidity-sensor", "Basic digital temperature and humidity sensor.", ["VCC", "DATA", "GND"], "digital", "3.3-5", ["DHT", "Adafruit Unified Sensor"], "temperature", ["dht11"], { temperatureRangeC: "0 to 50", humidityRangePercent: "20 to 80" }],
  ["BME280", "environment-sensor", "I2C pressure, humidity, and temperature sensor.", ["VIN", "GND", "SDA", "SCL"], "i2c", "3.3-5", ["Adafruit_BME280", "Adafruit Unified Sensor", "Wire"], "pressure", ["bme280"], { i2cAddress: "0x76 or 0x77", measures: ["temperature", "humidity", "pressure"] }],
  ["BMP280", "pressure-sensor", "I2C pressure and temperature sensor.", ["VIN", "GND", "SDA", "SCL"], "i2c", "3.3-5", ["Adafruit_BMP280", "Wire"], "pressure", ["bmp280"], { i2cAddress: "0x76 or 0x77" }],
  ["DS18B20", "temperature-sensor", "1-Wire temperature sensor.", ["VDD", "DQ", "GND"], "onewire", "3.3-5", ["OneWire", "DallasTemperature"], "temperature", ["ds18b20"], { interface: "1-Wire", needsPullup: "4.7k on data" }],
  ["HC-SR04 Ultrasonic Sensor", "distance-sensor", "Ultrasonic distance sensor with trigger and echo pins.", ["VCC", "TRIG", "ECHO", "GND"], "digital", 5, ["NewPing"], "distance", ["hc-sr04", "hcsr04", "ultrasonic"], { rangeCm: "2 to 400", echoVoltage: 5 }],
  ["PIR Motion Sensor", "motion-sensor", "Digital passive infrared motion detector.", ["VCC", "OUT", "GND"], "digital", "3.3-5", [], "motion", ["pir", "motion sensor", "hc-sr501"], { output: "digital HIGH on motion" }],
  ["LDR Light Sensor", "light-sensor", "Analog light sensor in a voltage divider.", ["VCC", "AO", "GND"], "analog", "3.3-5", [], "light", ["ldr", "photoresistor", "light sensor"], { companionResistorOhm: 10000 }],
  ["Capacitive Soil Moisture Sensor", "moisture-sensor", "Analog capacitive soil moisture probe.", ["VCC", "AO", "GND"], "analog", "3.3-5", [], "light", ["soil moisture", "moisture sensor"], { recommendedVariant: "capacitive corrosion-resistant probe" }],
  ["MQ-2 Gas Sensor", "gas-sensor", "Analog combustible gas and smoke sensor module.", ["VCC", "AO", "DO", "GND"], "analog", 5, [], "gas", ["mq-2", "mq2", "gas sensor", "smoke sensor"], { heaterVoltage: 5, warmupRequired: true }],
  ["MPU6050 IMU", "motion-imu", "I2C 6-axis accelerometer and gyroscope.", ["VCC", "GND", "SDA", "SCL"], "i2c", "3.3-5", ["MPU6050", "Wire"], "motion", ["mpu6050", "imu", "accelerometer", "gyroscope", "gyro"], { i2cAddress: "0x68 or 0x69" }],
  ["BH1750 Light Sensor", "lux-sensor", "I2C ambient light sensor.", ["VCC", "GND", "SDA", "SCL"], "i2c", "3.3-5", ["BH1750", "Wire"], "light", ["bh1750"], { i2cAddress: "0x23 or 0x5C" }],
  ["Relay Module", "switching-actuator", "Digital relay module for switching an external load.", ["VCC", "IN", "GND"], "digital", 5, [], "output", ["relay", "relay module"], { loadSupply: "external isolated load supply", useFlybackProtection: true }, "actuator"],
  ["SG90 Servo Motor", "position-actuator", "PWM hobby servo.", ["VCC", "SIGNAL", "GND"], "digital", 5, ["Servo"], "output", ["servo", "sg90"], { externalPowerRecommended: true }, "actuator"],
  ["DC Water Pump", "motor-actuator", "DC pump controlled through a relay or MOSFET.", ["V+", "CTRL", "GND"], "digital", 5, [], "output", ["pump", "water pump"], { driverRequired: "relay or logic-level MOSFET" }, "actuator"],
  ["DC Fan", "motor-actuator", "DC fan controlled through a transistor, MOSFET, or relay.", ["V+", "CTRL", "GND"], "digital", 5, [], "output", ["fan"], { driverRequired: "transistor, MOSFET, or relay" }, "actuator"],
  ["Buzzer", "audio-actuator", "Digital buzzer for alerts.", ["VCC", "IN", "GND"], "digital", "3.3-5", [], "output", ["buzzer"], { output: "tone or on/off alert" }, "actuator"],
  ["Status LED", "indicator", "LED indicator with current-limiting resistor.", ["ANODE", "CATHODE"], "digital", "3.3-5", [], "output", ["led", "status led"], { resistorOhm: "220 to 330" }, "actuator"],
  ["SSD1306 OLED Display", "display", "I2C monochrome OLED display.", ["VCC", "GND", "SDA", "SCL"], "i2c", "3.3-5", ["Adafruit_SSD1306", "Adafruit_GFX", "Wire"], "output", ["oled", "ssd1306"], { i2cAddress: "0x3C" }, "other"],
  ["16x2 I2C LCD", "display", "Character LCD with I2C backpack.", ["VCC", "GND", "SDA", "SCL"], "i2c", 5, ["LiquidCrystal_I2C", "Wire"], "output", ["lcd", "16x2", "i2c lcd"], { i2cAddress: "0x27 or 0x3F" }, "other"],
  ["SIM800L GSM Module", "communication-module", "UART GSM/GPRS modem.", ["VCC", "GND", "TX", "RX"], "uart", 4, ["TinyGSM"], "output", ["sim800l", "gsm"], { supplyVoltage: "3.7 to 4.2V high-current", peakCurrentA: 2 }, "other"],
  ["NEO-6M GPS Module", "position-sensor", "UART GPS receiver.", ["VCC", "GND", "TX", "RX"], "uart", "3.3-5", ["TinyGPSPlus"], "binary", ["gps", "neo-6m", "neo6m"], { interface: "UART NMEA" }],
].map(([name, category, description, pins, protocol, voltage, libraries, simulation, aliases, specifications, type]) => ({
  name: name as string,
  category: category as string,
  description: description as string,
  pins: pins as string[],
  protocol: protocol as Protocol,
  voltage: voltage as number | "3.3-5",
  libraries: libraries as string[],
  simulation: simulation as SimulationKind,
  aliases: aliases as string[],
  specifications: specifications as Record<string, unknown>,
  type: (type as Component["type"] | undefined) ?? "sensor",
}));

const toId = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const uniqueBy = <T>(items: T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item).toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const textMatches = (text: string, alias: string) =>
  new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text);

const detectPlatform = (prompt: string): { platform: HardwarePlatformType; specified: boolean } => {
  const checks: Array<[HardwarePlatformType, string[]]> = [
    [HardwarePlatformType.ARDUINO_NANO, ["arduino nano", "nano"]],
    [HardwarePlatformType.ARDUINO_UNO, ["arduino uno", "uno"]],
    [HardwarePlatformType.ESP32, ["esp32", "esp-32"]],
    [HardwarePlatformType.RASPBERRY_PI, ["raspberry pi", "raspi", "rpi"]],
    [HardwarePlatformType.STM32, ["stm32", "blue pill"]],
  ];
  for (const [platform, aliases] of checks) {
    if (aliases.some((alias) => textMatches(prompt, alias))) return { platform, specified: true };
  }
  if (/\b(wifi|wi-fi|bluetooth|ble|mqtt|web server|http|cloud)\b/i.test(prompt)) return { platform: HardwarePlatformType.ESP32, specified: false };
  if (/\bpython|linux|camera|opencv\b/i.test(prompt)) return { platform: HardwarePlatformType.RASPBERRY_PI, specified: false };
  if (/\b5v|relay|servo|beginner|simple arduino\b/i.test(prompt)) return { platform: HardwarePlatformType.ARDUINO_UNO, specified: false };
  return { platform: HardwarePlatformType.ARDUINO_UNO, specified: false };
};

const contextFromRagItems = (items: RagContextItem[]): HardwareContext => {
  const rawExtract = items.map((item) => item.content).join(" ");
  const lower = rawExtract.toLowerCase();
  const templates = componentCatalog.filter((template) => template.aliases.some((alias) => textMatches(lower, alias)));
  return {
    platform: detectPlatform(rawExtract).platform,
    components: templates.map((template) => ({
      id: toId(template.name),
      name: template.name,
      type: template.category,
      confidence: 0.72,
      reason: "Mentioned in supplied RAG context",
      sources: items.map((item) => item.id),
      specifications: template.specifications,
    })),
    libraries: uniqueBy(
      templates.flatMap((template) => template.libraries).map((library) => ({
        id: `lib-${toId(library)}`,
        name: library,
        type: "library",
        confidence: 0.72,
        reason: "Inferred from supplied RAG context",
        sources: items.map((item) => item.id),
      })),
      (library) => library.name,
    ),
    pinMappings: [],
    powerRequirements: [],
    communicationProtocols: [
      lower.includes("i2c") || lower.includes("i²c") ? "I2C" : "",
      lower.includes("spi") ? "SPI" : "",
      lower.includes("uart") || lower.includes("serial") ? "UART" : "",
    ].filter(Boolean),
    warnings: [],
    sources: items.map((item) => item.id),
    rawExtract: rawExtract.slice(0, 5000),
  };
};

const mergeContexts = (a: HardwareContext, b: HardwareContext): HardwareContext => ({
  platform: a.platform !== "unknown" ? a.platform : b.platform,
  components: uniqueBy([...a.components, ...b.components], (component) => component.name),
  libraries: uniqueBy([...a.libraries, ...b.libraries], (library) => library.name),
  pinMappings: [...a.pinMappings, ...b.pinMappings],
  powerRequirements: uniqueBy([...a.powerRequirements, ...b.powerRequirements], (power) => String(power.voltage)),
  communicationProtocols: uniqueBy([...a.communicationProtocols, ...b.communicationProtocols], (protocol) => protocol),
  warnings: uniqueBy([...a.warnings, ...b.warnings], (warning) => warning),
  sources: uniqueBy([...a.sources, ...b.sources], (source) => source),
  rawExtract: [a.rawExtract, b.rawExtract].filter(Boolean).join(" ").slice(0, 5000),
});

const emptyContext = (): HardwareContext => ({
  platform: "unknown",
  components: [],
  libraries: [],
  pinMappings: [],
  powerRequirements: [],
  communicationProtocols: [],
  warnings: [],
  sources: [],
  rawExtract: "",
});

const understandPrompt = (prompt: string, ragContext: RagContextItem[]): PromptUnderstanding => {
  const allText = `${prompt} ${ragContext.map((item) => item.content).join(" ")}`.toLowerCase();
  const platform = detectPlatform(prompt);
  const components = componentCatalog.filter((template) => template.aliases.some((alias) => textMatches(allText, alias)));
  const connectivity = uniqueBy(
    ["wifi", "wi-fi", "bluetooth", "ble", "mqtt", "http", "gsm", "lora", "gps"].filter((term) => allText.includes(term)).map((term) => term.replace("wi-fi", "wifi").toUpperCase()),
    (term) => term,
  );
  const powerSource = ["battery", "usb", "solar", "mains", "adapter", "power bank", "li-ion", "lipo"].find((source) => allText.includes(source));
  const goals = prompt.split(/[.;\n]/).map((goal) => goal.trim()).filter(Boolean);
  const controlLogic = goals.filter((goal) => /\b(if|when|then|control|turn|alert|threshold|monitor|send|display|log)\b/i.test(goal));
  return { platform: platform.platform, platformSpecified: platform.specified, components, powerSource, connectivity, goals: goals.length ? goals : [prompt], controlLogic };
};

const platformVoltage = (platform: HardwarePlatformType) => basePinouts[platform][0]?.voltage ?? 3.3;

const powerRailFor = (platform: HardwarePlatformType, voltage: ComponentTemplate["voltage"]) => {
  if (voltage === 5) return "5V";
  if (voltage === 4) return "VBAT";
  return platformVoltage(platform) >= 5 ? "5V" : "3V3";
};

const protocolPins = (platform: HardwarePlatformType): Record<string, string> => ({
  [HardwarePlatformType.ARDUINO_UNO]: { SDA: "A4", SCL: "A5", MOSI: "D11", MISO: "D12", SCK: "D13", TX: "D1", RX: "D0", CS: "D10" },
  [HardwarePlatformType.ARDUINO_NANO]: { SDA: "A4", SCL: "A5", MOSI: "D11", MISO: "D12", SCK: "D13", TX: "D1", RX: "D0", CS: "D10" },
  [HardwarePlatformType.ESP32]: { SDA: "GPIO21", SCL: "GPIO22", MOSI: "GPIO23", MISO: "GPIO19", SCK: "GPIO18", TX: "GPIO17", RX: "GPIO16", CS: "GPIO5" },
  [HardwarePlatformType.RASPBERRY_PI]: { SDA: "GPIO2", SCL: "GPIO3", MOSI: "GPIO10", MISO: "GPIO9", SCK: "GPIO11", TX: "GPIO14", RX: "GPIO15", CS: "GPIO8" },
  [HardwarePlatformType.STM32]: { SDA: "PB7", SCL: "PB6", MOSI: "PA7", MISO: "PA6", SCK: "PA5", TX: "PA2", RX: "PA3", CS: "PA4" },
}[platform]);

const makeConnection = (componentId: string, pinName: string, platformPin: string, type: Connection["type"]): Connection => ({
  from: { componentId, pinName, platformPin },
  to: { componentId: "platform", pinName: platformPin, platformPin },
  type,
});

const allocateWiring = (platform: HardwarePlatformType, components: ComponentTemplate[]) => {
  const pins = basePinouts[platform];
  const busPins = protocolPins(platform);
  const used = new Set<string>();
  const notes: string[] = [];
  const validation: string[] = [];
  const sensors: Sensor[] = [];
  const connections: Connection[] = [];
  const reserve = (pin: string) => {
    used.add(pin);
    return pin;
  };
  const findPin = (kind: "analog" | "digital") => {
    const pin = pins.find((candidate) => !used.has(candidate.pinNumber) && (kind === "analog" ? candidate.function.includes("ADC") : candidate.function.includes("GPIO") && !candidate.function.includes("input only")));
    return pin ? reserve(pin.pinNumber) : "";
  };

  for (const component of components) {
    const id = toId(component.name);
    const sensor: Sensor | undefined = component.type === "sensor" ? { id, name: component.name, type: component.category, description: component.description, pins: [] } : undefined;
    for (const pinName of component.pins) {
      const pin = pinName.toUpperCase();
      if (["VCC", "VIN", "VDD", "V+"].includes(pin)) {
        const rail = powerRailFor(platform, component.voltage);
        connections.push(makeConnection(id, pinName, rail, "power"));
        notes.push(`${component.name} ${pinName} connects to ${rail} because the module voltage requirement is ${component.voltage}.`);
        continue;
      }
      if (["GND", "CATHODE"].includes(pin)) {
        connections.push(makeConnection(id, pinName, "GND", "ground"));
        notes.push(`${component.name} ${pinName} connects to common GND so signal references match the controller.`);
        continue;
      }

      let platformPin = "";
      let type: Connection["type"] = "digital";
      if (pin === "SDA" || pin === "SCL") {
        platformPin = busPins[pin];
        notes.push(`${component.name} ${pinName} shares the I2C ${pin} bus on ${platformPin}; confirm unique I2C address and pull-up voltage.`);
      } else if (["MOSI", "MISO", "SCK"].includes(pin)) {
        platformPin = busPins[pin];
        notes.push(`${component.name} ${pinName} uses platform SPI ${pin} on ${platformPin}.`);
      } else if (pin === "TX") {
        platformPin = busPins.RX;
        notes.push(`${component.name} TX connects to controller RX ${platformPin}.`);
      } else if (pin === "RX") {
        platformPin = busPins.TX;
        notes.push(`${component.name} RX connects to controller TX ${platformPin}.`);
      } else if (component.protocol === "analog" || pin === "AO") {
        platformPin = findPin("analog");
        type = "analog";
        notes.push(`${component.name} ${pinName} connects to analog-capable input ${platformPin}.`);
      } else {
        platformPin = findPin("digital");
        notes.push(`${component.name} ${pinName} connects to unique GPIO ${platformPin}.`);
      }
      if (!platformPin) {
        validation.push(`No available ${component.protocol} pin remained for ${component.name} ${pinName}; manual reassignment is required.`);
        continue;
      }
      connections.push(makeConnection(id, pinName, platformPin, type));
      sensor?.pins.push({ componentId: id, pinName, platformPin });
    }
    if (sensor) sensors.push(sensor);
  }

  return { sensors, connections, notes, validation };
};

const componentFromTemplate = (template: ComponentTemplate, confidence: number, assumptions: string[]): Component => ({
  id: toId(template.name),
  name: template.name,
  type: template.type,
  category: template.category,
  description: template.description,
  quantity: 1,
  specifications: {
    ...template.specifications,
    protocol: template.protocol,
    voltage: template.voltage,
    confidence,
    assumptions,
  },
});

const mergeExistingComponents = (components: Component[], projectState?: Record<string, unknown>) => {
  const existing = Array.isArray(projectState?.requiredComponents) ? projectState.requiredComponents as Component[] : [];
  return uniqueBy([...existing, ...components], (component) => component.id);
};

const enrichComponents = (understanding: PromptUnderstanding, context: HardwareContext) => {
  const contextText = [context.rawExtract, ...context.components.map((component) => component.name)].join(" ").toLowerCase();
  const fromContext = componentCatalog.filter((template) => template.aliases.some((alias) => textMatches(contextText, alias)));
  return uniqueBy([...understanding.components, ...fromContext], (component) => component.name);
};

const validatePlan = (platform: HardwarePlatformType, components: ComponentTemplate[], connections: Connection[], context: HardwareContext) => {
  const notes: string[] = [];
  const boardVoltage = platformVoltage(platform);
  const usage = new Map<string, string[]>();
  for (const conn of connections.filter((item) => item.type !== "power" && item.type !== "ground")) {
    if (["SDA", "SCL", "MOSI", "MISO", "SCK"].includes(conn.from.pinName.toUpperCase())) continue;
    usage.set(conn.from.platformPin, [...usage.get(conn.from.platformPin) ?? [], conn.from.componentId]);
  }
  for (const [pin, users] of usage.entries()) {
    if (users.length > 1) notes.push(`Validation: duplicate GPIO ${pin} used by ${users.join(", ")}; reassign one signal before fabrication.`);
  }
  for (const component of components) {
    if (component.voltage === 5 && boardVoltage < 5) notes.push(`Validation: ${component.name} expects 5V while ${platformNames[platform]} logic is ${boardVoltage}V; use a level shifter or compatible module.`);
    if (component.voltage === 4) notes.push(`Validation: ${component.name} needs a dedicated high-current 3.7-4.2V supply; do not power it from a GPIO rail.`);
    if (component.protocol === "analog" && platform === HardwarePlatformType.RASPBERRY_PI) notes.push(`Validation: ${component.name} is analog but Raspberry Pi has no native ADC; add MCP3008 or equivalent.`);
  }
  if (components.filter((component) => component.protocol === "i2c").length > 1) notes.push("Validation: I2C devices intentionally share SDA/SCL; verify addresses do not conflict.");
  if (components.filter((component) => component.protocol === "spi").length > 1) notes.push("Validation: SPI devices may share bus pins but each device needs a unique chip select.");
  if (components.filter((component) => component.protocol === "uart").length > 1) notes.push("Validation: multiple UART devices may require extra hardware serial ports or SoftwareSerial-compatible pins.");
  notes.push(...context.warnings.map((warning) => `RAG best practice: ${warning}.`));
  return uniqueBy(notes, (note) => note);
};

const buildFirmwareGoals = (understanding: PromptUnderstanding, platform: HardwarePlatformType, components: ComponentTemplate[]) => uniqueBy([
  `Initialize ${platformNames[platform]} pins, serial logging, and deterministic safe startup states.`,
  ...uniqueBy(components.map((component) => component.protocol), (protocol) => protocol).map((protocol) => {
    if (protocol === "i2c") return "Initialize I2C, scan expected addresses, and handle missing devices gracefully.";
    if (protocol === "spi") return "Initialize SPI with component-safe chip select and clock settings.";
    if (protocol === "uart") return "Initialize UART peripherals with baud rate, timeout, and framing checks.";
    if (protocol === "analog") return "Sample analog channels repeatedly, smooth noisy readings, and calibrate thresholds.";
    if (protocol === "onewire") return "Initialize the 1-Wire bus and verify sensor presence before readings.";
    return "Configure digital inputs and outputs with pull-ups, debouncing, and explicit output defaults.";
  }),
  ...components.filter((component) => component.type === "sensor").map((component) => `Read ${component.name}, validate realistic ranges, and expose named values to control logic.`),
  ...components.filter((component) => component.type === "actuator").map((component) => `Drive ${component.name} from explicit control decisions, with fail-safe OFF behavior on sensor or communication failure.`),
  ...understanding.controlLogic.map((logic) => `Implement requested control rule: ${logic}.`),
  ...(understanding.connectivity.length ? [`Transmit or publish telemetry over ${understanding.connectivity.join(", ")} with reconnection and timeout handling.`] : []),
], (goal) => goal);

const librariesFor = (platform: HardwarePlatformType, understanding: PromptUnderstanding, components: ComponentTemplate[], context: HardwareContext) => {
  const libraries = new Set<string>();
  components.flatMap((component) => component.libraries).forEach((library) => libraries.add(library));
  context.libraries.forEach((library) => libraries.add(library.name));
  if (components.some((component) => component.protocol === "i2c")) libraries.add("Wire");
  if (components.some((component) => component.protocol === "spi")) libraries.add("SPI");
  if (understanding.connectivity.includes("WIFI") && platform === HardwarePlatformType.ESP32) libraries.add("WiFi");
  if (understanding.connectivity.includes("MQTT")) libraries.add("PubSubClient");
  if (libraries.size === 0 && platform !== HardwarePlatformType.RASPBERRY_PI) libraries.add("Arduino");
  if (libraries.size === 0) libraries.add("No Arduino library identified; Raspberry Pi GPIO library required");
  return Array.from(libraries);
};

const buildSimulationRequirements = (components: ComponentTemplate[], connections: Connection[]) => {
  const values: Record<SimulationKind, number[]> = {
    temperature: [22, 23, 25, 27, 24],
    pressure: [1008, 1010, 1012, 1009, 1011],
    distance: [120, 80, 40, 25, 90],
    motion: [0, 0, 1, 1, 0],
    light: [180, 420, 760, 300, 120],
    gas: [180, 220, 450, 700, 260],
    binary: [0, 1, 1, 0, 1],
    output: [0, 1, 0, 1, 0],
  };
  const signalPins = ["DATA", "OUT", "ECHO", "AO", "DQ", "SDA", "TX"];
  return {
    duration: Math.max(10000, components.length * 3000),
    inputSignals: components.filter((component) => component.type === "sensor").map((component) => {
      const conn = connections.find((item) => item.from.componentId === toId(component.name) && signalPins.includes(item.from.pinName.toUpperCase()));
      return {
        pin: conn?.from.platformPin ?? "",
        type: conn?.type === "analog" ? "analog" as const : "digital" as const,
        values: values[component.simulation],
        intervalMs: component.protocol === "i2c" ? 1000 : 500,
      };
    }),
    expectedOutputs: components.filter((component) => component.type === "actuator" || component.category === "display").map((component) => {
      const conn = connections.find((item) => item.from.componentId === toId(component.name) && !["VCC", "VIN", "VDD", "V+", "GND", "CATHODE"].includes(item.from.pinName.toUpperCase()));
      return {
        pin: conn?.from.platformPin ?? "",
        type: conn?.type === "analog" ? "analog" as const : "digital" as const,
        expectedValues: conn?.type === "analog" ? undefined : [0, 1, 1, 0],
        min: conn?.type === "analog" ? 0 : undefined,
        max: conn?.type === "analog" ? 1023 : undefined,
      };
    }),
  };
};

const synthesizePlan = (inputs: PlannerInputs, retrievalResult?: RetrievalResult): PlannerResponse => {
  const suppliedContext = contextFromRagItems(inputs.ragContext ?? []);
  const retrievalContext = retrievalResult?.context ?? emptyContext();
  const context = mergeContexts(retrievalContext, suppliedContext);
  const understanding = understandPrompt(inputs.prompt, inputs.ragContext ?? []);
  const platform = understanding.platform;
  const assumptions = [
    understanding.platformSpecified ? `${platformNames[platform]} was requested explicitly` : `platform inferred as ${platformNames[platform]} because no platform was specified`,
    understanding.powerSource ? `power source interpreted as ${understanding.powerSource}` : "power source not specified; assume regulated USB or bench supply for prototyping",
  ];
  let components = enrichComponents(understanding, context);
  if (components.length === 0) {
    assumptions.push("no exact component was identified; minimal generic digital input and status LED are included with low confidence");
    components = [
      { aliases: ["generic input"], name: "Generic Digital Input Module", type: "sensor", category: "generic-digital-sensor", description: "Low-confidence placeholder because the prompt and RAG context did not name a concrete sensor.", pins: ["VCC", "OUT", "GND"], protocol: "digital", voltage: "3.3-5", libraries: [], simulation: "binary", specifications: { replaceBeforeFabrication: true } },
      componentCatalog.find((component) => component.name === "Status LED")!,
    ];
  }

  const confidence = retrievalResult?.success ? retrievalResult.confidence : context.sources.length ? 0.58 : 0.42;
  const hardwarePlatform: HardwarePlatform = { type: platform, name: platformNames[platform], pinout: basePinouts[platform] };
  const wiring = allocateWiring(platform, components);
  const wiringPlan: WiringPlan = {
    connections: wiring.connections,
    notes: uniqueBy([
      ...wiring.notes,
      ...wiring.validation.map((note) => `Validation: ${note}`),
      ...validatePlan(platform, components, wiring.connections, context),
      `Confidence ${(confidence * 100).toFixed(0)}%. ${components.length} component(s) identified; ${context.sources.length || 0} RAG source(s) used. Assumptions: ${assumptions.join("; ")}.`,
    ], (note) => note),
  };

  return {
    projectRequirements: uniqueBy([
      ...understanding.goals,
      `Hardware platform: ${hardwarePlatform.name}${understanding.platformSpecified ? " requested explicitly" : " inferred"}.`,
      `Components: ${components.map((component) => component.name).join(", ")}.`,
      understanding.connectivity.length ? `Connectivity: ${understanding.connectivity.join(", ")}.` : "",
      understanding.powerSource ? `Power source: ${understanding.powerSource}.` : "Power source: regulated prototype supply assumed.",
      context.sources.length ? `RAG sources used: ${context.sources.join(", ")}.` : "RAG sources used: none available; assumptions are marked in component specifications and wiring notes.",
    ].filter(Boolean), (item) => item),
    hardwarePlatform,
    sensors: wiring.sensors,
    firmwareGoals: buildFirmwareGoals(understanding, platform, components),
    requiredComponents: mergeExistingComponents(components.map((component) => componentFromTemplate(component, confidence, assumptions)), inputs.projectState),
    wiringPlan,
    wiringStrategy: `Use ${hardwarePlatform.name} as the controller. Wire power and ground first, share common ground across all modules, use platform-standard I2C/SPI/UART pins, reserve unique GPIO pins for non-bus signals, and resolve every validation note before fabrication.`,
    libraries: librariesFor(platform, understanding, components, context),
    simulationRequirements: buildSimulationRequirements(components, wiring.connections),
  };
};

export async function buildPlanWithRetrieval(
  inputs: PlannerInputs,
  retrieverService?: RetrievalService,
): Promise<PlannerResponse> {
  const service = retrieverService || createRetrievalService({ enabled: inputs.useRetrieval !== false });
  console.log(`[Planner] Starting retrieval-first planning for: "${inputs.prompt.slice(0, 50)}..."`);
  const retrievalResult = await service.retrieve(inputs.prompt);
  if (!retrievalResult.success && retrievalResult.error) {
    console.warn(`[Planner] Retrieval failed, using prompt and provided RAG context: ${retrievalResult.error}`);
  }
  return synthesizePlan(inputs, retrievalResult);
}

export const buildPlan = (inputs: PlannerInputs): PlannerResponse => {
  return synthesizePlan(inputs);
};
