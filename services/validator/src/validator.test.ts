import { describe, expect, it } from "vitest";
import { validateElectrical } from "./validator.js";
import type { GeneratorResponse } from "@wireup/types";
import type { NgspiceServiceLike } from "@wireup/ngspice";

const baseGeneratorOutput: GeneratorResponse = {
  firmware: {
    language: "arduino",
    code: "// code",
    libraries: ["DHT"],
  },
  wiring: {
    connections: [
      {
        from: { componentId: "sensor-dht22", pinName: "DATA", platformPin: "D2" },
        to: { componentId: "platform", pinName: "D2", platformPin: "D2" },
        type: "digital",
      },
      {
        from: { componentId: "power-rail", pinName: "VCC", platformPin: "VCC" },
        to: { componentId: "platform", pinName: "VCC", platformPin: "VCC" },
        type: "power",
      },
      {
        from: { componentId: "power-rail", pinName: "GND", platformPin: "GND" },
        to: { componentId: "platform", pinName: "GND", platformPin: "GND" },
        type: "ground",
      },
    ],
    notes: ["Use common ground"],
  },
  componentList: [
    {
      id: "sensor-dht22",
      name: "DHT22",
      type: "sensor",
      description: "Sensor",
      specifications: { interface: "single-wire", voltage: "5V" },
      quantity: 1,
    },
  ],
  assemblyInstructions: [],
  projectMetadata: {
    title: "ESP32 Sensor",
    description: "Test",
    tags: ["esp32"],
    difficulty: "beginner",
  },
  wiringMetadata: {
    totalConnections: 3,
    analogConnections: 0,
    digitalConnections: 1,
    powerConnections: 1,
    groundConnections: 1,
    pinUsage: { D2: ["sensor-dht22"] },
  },
  simulationJson: {
    version: "1.0",
    components: [],
    connections: [],
    setup: { timeStep: 10, duration: 10000 },
  },
};

describe("validateElectrical", () => {
  const mockService = (payload: unknown) =>
    ({
      validate: async () => payload,
    }) as unknown as NgspiceServiceLike;

  it("returns valid result when no errors", async () => {
    const result = await validateElectrical(
      baseGeneratorOutput,
      mockService({
        errors: [],
        warnings: [],
        voltages: { vcc: 5 },
        currents: {},
        summary: {
          status: "valid",
          totalErrors: 0,
          totalWarnings: 0,
          ngspiceExitCode: 0,
        },
      }),
    );

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("flags missing ground connections", async () => {
    const result = await validateElectrical(
      baseGeneratorOutput,
      mockService({
        errors: [
          {
            code: "MISSING_GROUND",
            message: "Missing ground connection",
          },
        ],
        warnings: [],
        voltages: {},
        currents: {},
        summary: {
          status: "invalid",
          totalErrors: 1,
          totalWarnings: 0,
          ngspiceExitCode: 0,
        },
      }),
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.some((error) => error.message.includes("Missing ground"))).toBe(true);
  });

  it("surfaces ngspice failures", async () => {
    const result = await validateElectrical(
      baseGeneratorOutput,
      mockService({
        errors: [
          {
            code: "NGSPICE_FAILED",
            message: "ngspice execution failed",
          },
        ],
        warnings: [],
        voltages: {},
        currents: {},
        summary: {
          status: "invalid",
          totalErrors: 1,
          totalWarnings: 0,
          ngspiceExitCode: 1,
        },
      }),
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.some((error) => error.message.includes("ngspice"))).toBe(true);
  });
});
