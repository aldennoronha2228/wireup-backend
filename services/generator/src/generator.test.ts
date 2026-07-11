import { describe, expect, it } from "vitest";
import { buildGeneratorOutput } from "./generator.js";
import type { PlannerResponse } from "@wireup/types";

const plan: PlannerResponse = {
  projectRequirements: ["Build a temperature logger"],
  hardwarePlatform: {
    type: "esp32",
    name: "ESP32",
    pinout: [
      { pinNumber: "GPIO2", function: "GPIO", voltage: 3.3 },
      { pinNumber: "GPIO34", function: "ADC", voltage: 3.3 },
    ],
  },
  sensors: [
    {
      id: "sensor-dht22",
      name: "DHT22",
      type: "temperature-humidity",
      description: "Sensor",
      pins: [{ componentId: "sensor-dht22", pinName: "DATA", platformPin: "GPIO2" }],
    },
  ],
  firmwareGoals: ["Read temperature"],
  requiredComponents: [
    {
      id: "sensor-dht22",
      name: "DHT22",
      type: "sensor",
      description: "Sensor",
      specifications: { interface: "single-wire" },
      quantity: 1,
    },
  ],
  wiringPlan: {
    connections: [
      {
        from: { componentId: "sensor-dht22", pinName: "DATA", platformPin: "GPIO2" },
        to: { componentId: "platform", pinName: "GPIO2", platformPin: "GPIO2" },
        type: "digital",
      },
    ],
    notes: ["Use common ground"],
  },
  wiringStrategy: "Connect signal to GPIO2",
  libraries: ["DHT"],
  simulationRequirements: {
    duration: 10000,
    inputSignals: [],
    expectedOutputs: [],
  },
};

describe("buildGeneratorOutput", () => {
  it("builds deterministic generator output", () => {
    const first = buildGeneratorOutput(plan);
    const second = buildGeneratorOutput(plan);

    expect(first).toEqual(second);
    expect(first.wiringMetadata.totalConnections).toBe(1);
    expect(first.firmware.code).toContain("void setup()");
  });

  it("does not include markdown", () => {
    const output = buildGeneratorOutput(plan);

    const strings = [
      output.projectMetadata.title,
      output.projectMetadata.description,
      ...output.assemblyInstructions.map((item) => item.description),
    ];

    strings.forEach((value) => {
      expect(value).not.toMatch(/```/);
      expect(value).not.toMatch(/^\s*[-*#]/);
    });
  });
});
