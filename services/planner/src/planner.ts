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

interface PlannerInputs {
  prompt: string;
  ragContext: RagContextItem[];
  projectState?: Record<string, unknown>;
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

const keywordMap = [
  {
    keywords: ["temperature", "humidity"],
    sensor: {
      id: "sensor-dht22",
      name: "DHT22",
      type: "temperature-humidity",
      description: "Digital temperature and humidity sensor",
      pins: [
        { componentId: "sensor-dht22", pinName: "DATA", platformPin: "" },
      ],
    },
    component: {
      id: "sensor-dht22",
      name: "DHT22",
      type: "sensor" as const,
      description: "Digital temperature and humidity sensor",
      specifications: { interface: "single-wire", voltage: "3.3-5V" },
      quantity: 1,
    },
    libraries: ["DHT"],
  },
  {
    keywords: ["motion", "pir"],
    sensor: {
      id: "sensor-pir",
      name: "PIR Motion Sensor",
      type: "motion",
      description: "Passive infrared motion sensor",
      pins: [{ componentId: "sensor-pir", pinName: "OUT", platformPin: "" }],
    },
    component: {
      id: "sensor-pir",
      name: "PIR Motion Sensor",
      type: "sensor" as const,
      description: "Passive infrared motion sensor",
      specifications: { interface: "digital", voltage: "3.3-5V" },
      quantity: 1,
    },
    libraries: [],
  },
  {
    keywords: ["light", "lux"],
    sensor: {
      id: "sensor-bh1750",
      name: "BH1750",
      type: "light",
      description: "I2C ambient light sensor",
      pins: [{ componentId: "sensor-bh1750", pinName: "SDA", platformPin: "" }],
    },
    component: {
      id: "sensor-bh1750",
      name: "BH1750",
      type: "sensor" as const,
      description: "I2C ambient light sensor",
      specifications: { interface: "i2c", voltage: "3.3V" },
      quantity: 1,
    },
    libraries: ["BH1750"],
  },
  {
    keywords: ["distance", "ultrasonic"],
    sensor: {
      id: "sensor-hcsr04",
      name: "HC-SR04",
      type: "distance",
      description: "Ultrasonic distance sensor",
      pins: [
        { componentId: "sensor-hcsr04", pinName: "TRIG", platformPin: "" },
        { componentId: "sensor-hcsr04", pinName: "ECHO", platformPin: "" },
      ],
    },
    component: {
      id: "sensor-hcsr04",
      name: "HC-SR04",
      type: "sensor" as const,
      description: "Ultrasonic distance sensor",
      specifications: { interface: "digital", voltage: "5V" },
      quantity: 1,
    },
    libraries: [],
  },
  {
    keywords: ["pressure", "barometer"],
    sensor: {
      id: "sensor-bmp280",
      name: "BMP280",
      type: "pressure",
      description: "I2C pressure sensor",
      pins: [{ componentId: "sensor-bmp280", pinName: "SCL", platformPin: "" }],
    },
    component: {
      id: "sensor-bmp280",
      name: "BMP280",
      type: "sensor" as const,
      description: "I2C pressure sensor",
      specifications: { interface: "i2c", voltage: "3.3V" },
      quantity: 1,
    },
    libraries: ["Adafruit_BMP280"],
  },
  {
    keywords: ["gas", "air quality"],
    sensor: {
      id: "sensor-mq2",
      name: "MQ-2",
      type: "gas",
      description: "Gas and smoke sensor",
      pins: [{ componentId: "sensor-mq2", pinName: "A0", platformPin: "" }],
    },
    component: {
      id: "sensor-mq2",
      name: "MQ-2",
      type: "sensor" as const,
      description: "Gas and smoke sensor",
      specifications: { interface: "analog", voltage: "5V" },
      quantity: 1,
    },
    libraries: [],
  },
  {
    keywords: ["accelerometer", "imu"],
    sensor: {
      id: "sensor-mpu6050",
      name: "MPU6050",
      type: "imu",
      description: "I2C accelerometer and gyro",
      pins: [{ componentId: "sensor-mpu6050", pinName: "SDA", platformPin: "" }],
    },
    component: {
      id: "sensor-mpu6050",
      name: "MPU6050",
      type: "sensor" as const,
      description: "I2C accelerometer and gyro",
      specifications: { interface: "i2c", voltage: "3.3V" },
      quantity: 1,
    },
    libraries: ["MPU6050"],
  },
  {
    keywords: ["soil", "moisture"],
    sensor: {
      id: "sensor-soil",
      name: "Soil Moisture Sensor",
      type: "soil",
      description: "Analog soil moisture sensor",
      pins: [{ componentId: "sensor-soil", pinName: "A0", platformPin: "" }],
    },
    component: {
      id: "sensor-soil",
      name: "Soil Moisture Sensor",
      type: "sensor" as const,
      description: "Analog soil moisture sensor",
      specifications: { interface: "analog", voltage: "3.3-5V" },
      quantity: 1,
    },
    libraries: [],
  },
  {
    keywords: ["relay"],
    sensor: null,
    component: {
      id: "actuator-relay",
      name: "Relay Module",
      type: "actuator" as const,
      description: "Single channel relay",
      specifications: { interface: "digital", voltage: "5V" },
      quantity: 1,
    },
    libraries: [],
  },
  {
    keywords: ["servo"],
    sensor: null,
    component: {
      id: "actuator-servo",
      name: "Servo Motor",
      type: "actuator" as const,
      description: "Standard servo motor",
      specifications: { interface: "pwm", voltage: "5V" },
      quantity: 1,
    },
    libraries: ["Servo"],
  },
  {
    keywords: ["led"],
    sensor: null,
    component: {
      id: "actuator-led",
      name: "LED",
      type: "actuator" as const,
      description: "Status LED",
      specifications: { interface: "digital", voltage: "3.3-5V" },
      quantity: 1,
    },
    libraries: [],
  },
];

const detectPlatform = (text: string) => {
  const lower = text.toLowerCase();
  if (lower.includes("esp32")) return HardwarePlatformType.ESP32;
  if (lower.includes("raspberry")) return HardwarePlatformType.RASPBERRY_PI;
  if (lower.includes("stm32")) return HardwarePlatformType.STM32;
  if (lower.includes("nano")) return HardwarePlatformType.ARDUINO_NANO;
  return HardwarePlatformType.ARDUINO_UNO;
};

const extractRequirements = (prompt: string) =>
  prompt
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

const assignPins = (pinout: HardwarePlatform["pinout"], count: number) =>
  pinout.slice(0, count).map((pin) => pin.pinNumber);

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

export const buildPlan = (inputs: PlannerInputs): PlannerResponse => {
  const contextText = inputs.ragContext.map((item) => item.content).join(" ");
  const signalText = `${inputs.prompt} ${contextText}`;
  const platformType = detectPlatform(signalText);

  const hardwarePlatform: HardwarePlatform = {
    type: platformType,
    name: platformNames[platformType],
    pinout: basePinouts[platformType],
  };

  const requirements = extractRequirements(inputs.prompt);
  const matchedItems = keywordMap.filter((entry) =>
    entry.keywords.some((keyword) => signalText.toLowerCase().includes(keyword)),
  );

  const sensors: Sensor[] = [];
  const components: Component[] = [];
  const libraries = new Set<string>();

  matchedItems.forEach((entry) => {
    if (entry.sensor) {
      sensors.push({ ...entry.sensor, pins: [...entry.sensor.pins] });
    }
    if (entry.component) {
      components.push(entry.component);
    }
    entry.libraries.forEach((library) => libraries.add(library));
  });

  if (sensors.length === 0) {
    sensors.push({
      id: "sensor-default",
      name: "Generic Analog Sensor",
      type: "analog",
      description: "Placeholder analog sensor",
      pins: [{ componentId: "sensor-default", pinName: "A0", platformPin: "" }],
    });
    components.push({
      id: "sensor-default",
      name: "Generic Analog Sensor",
      type: "sensor",
      description: "Placeholder analog sensor",
      specifications: { interface: "analog" },
      quantity: 1,
    });
  }

  const neededPins = sensors.reduce((sum, sensor) => sum + sensor.pins.length, 0);
  const assignedPins = assignPins(hardwarePlatform.pinout, neededPins);

  let pinIndex = 0;
  sensors.forEach((sensor) => {
    sensor.pins = sensor.pins.map((pin) => ({
      ...pin,
      platformPin: assignedPins[pinIndex++] || hardwarePlatform.pinout[0].pinNumber,
    }));
  });

  const wiringPlan: WiringPlan = {
    connections: sensors.flatMap((sensor) =>
      sensor.pins.map((pin) => ({
        from: pin,
        to: createPlatformAssignment(pin.platformPin),
        type: pin.pinName === "A0" ? "analog" : "digital",
      })),
    ),
    notes: [
      "Provide stable power and ground rails shared across all components",
      "Use pull-up resistors where required by digital sensors",
    ],
  };

  const firmwareGoals = [
    "Initialize hardware interfaces",
    "Read sensor data at a fixed interval",
    "Validate sensor values before use",
  ];

  if (components.some((component) => component.type === "actuator")) {
    firmwareGoals.push("Drive actuators based on control rules");
  }

  const wiringStrategy =
    "Connect each sensor signal line to unique GPIO or ADC pins and share common power and ground rails.";

  const mergedComponents = mergeExistingComponents(components, inputs.projectState);

  return {
    projectRequirements: requirements.length > 0 ? requirements : [inputs.prompt],
    hardwarePlatform,
    sensors,
    firmwareGoals,
    requiredComponents: mergedComponents,
    wiringPlan,
    wiringStrategy,
    libraries: Array.from(libraries),
    simulationRequirements: {
      duration: 10000,
      inputSignals: [],
      expectedOutputs: [],
    },
  };
};
