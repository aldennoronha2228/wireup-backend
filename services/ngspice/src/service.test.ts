import { describe, expect, it, vi } from "vitest";
import { buildNetlist } from "./netlist.js";
import { NgspiceService } from "./service.js";
import type { NgspiceRequest } from "./schema.js";

const validLedRequest = (): NgspiceRequest => ({
  circuitId: "LED Test",
  components: [
    {
      id: "R1",
      name: "R1",
      type: "resistor",
      specifications: { resistance: 220 },
    },
    {
      id: "D1",
      name: "D1",
      type: "LED",
    },
  ],
  connections: [
    {
      from: { componentId: "board", pinName: "5V" },
      to: { componentId: "R1", pinName: "1" },
      type: "power",
    },
    {
      from: { componentId: "R1", pinName: "2" },
      to: { componentId: "D1", pinName: "anode" },
      type: "analog",
    },
    {
      from: { componentId: "D1", pinName: "cathode" },
      to: { componentId: "board", pinName: "GND" },
      type: "ground",
    },
  ],
  board: {
    platform: "test",
    voltage: 5,
    powerPins: ["5V"],
    groundPins: ["GND"],
  },
});

const validLedRequestWithPlatformPins = (): NgspiceRequest => ({
  ...validLedRequest(),
  connections: [
    {
      from: { componentId: "R1", pinName: "1", platformPin: "5V" },
      to: { componentId: "platform", pinName: "5V", platformPin: "5V" },
      type: "power",
    },
    {
      from: { componentId: "R1", pinName: "2", platformPin: "A0" },
      to: { componentId: "D1", pinName: "anode", platformPin: "A0" },
      type: "analog",
    },
    {
      from: { componentId: "D1", pinName: "cathode", platformPin: "GND" },
      to: { componentId: "platform", pinName: "GND", platformPin: "GND" },
      type: "ground",
    },
  ],
});

const runnerOutput = `
No. of Data Rows : 1
\tNode                                  Voltage
\t----                                  -------
\tN1                               1.800000e+00
\tVCC                              5.000000e+00

\tSource\tCurrent
\t------\t-------

\tvcc#branch                       -1.454545e-02
`;

describe("NgspiceService", () => {
  it("generates the expected SPICE netlist for a valid LED circuit", () => {
    expect(buildNetlist(validLedRequest()).netlist).toBe(`* LED Test

VCC VCC 0 DC 5
R1 VCC N1 220
D1 N1 0 LED

.model LED D

.op

.end`);
  });

  it("keeps component terminals distinct from platform pin labels", () => {
    const build = buildNetlist(validLedRequestWithPlatformPins());

    expect(build.netlist).toBe(`* LED Test

VCC VCC 0 DC 5
R1 VCC N1 220
D1 N1 0 LED

.model LED D

.op

.end`);
    expect(Object.fromEntries(build.endpointToNet)).toMatchObject({
      "R1:1": "VCC",
      "platform:5V": "VCC",
      "R1:2": "N1",
      "D1:anode": "N1",
      "D1:cathode": "0",
      "platform:GND": "0",
    });
  });

  it("reports a valid LED circuit as valid", async () => {
    const runner = vi.fn(async () => ({
      exitCode: 0,
      stdout: runnerOutput,
      stderr: "",
    }));
    const service = new NgspiceService(runner);

    const response = await service.validate(validLedRequest());

    expect(response.summary.status).toBe("valid");
    expect(response.errors).toHaveLength(0);
    expect(response.errors.some((error) => error.code === "FLOATING_NODE")).toBe(false);
    expect(response.errors.some((error) => error.code === "OPEN_CIRCUIT")).toBe(false);
    expect(response.voltages).toEqual({ N1: 1.8, VCC: 5 });
    expect(runner).toHaveBeenCalledOnce();
  });

  it("detects missing ground before simulation", async () => {
    const request = validLedRequest();
    request.connections = request.connections.filter((connection) => connection.type !== "ground");
    const runner = vi.fn();
    const response = await new NgspiceService(runner).validate(request);

    expect(response.summary.status).toBe("invalid");
    expect(response.errors.some((error) => error.code === "MISSING_GROUND")).toBe(true);
    expect(runner).not.toHaveBeenCalled();
  });

  it("detects a floating resistor before simulation", async () => {
    const request: NgspiceRequest = {
      ...validLedRequest(),
      components: [
        { id: "R1", name: "R1", type: "resistor", specifications: { resistance: 220 } },
      ],
      connections: [
        {
          from: { componentId: "board", pinName: "5V" },
          to: { componentId: "R1", pinName: "1" },
          type: "power",
        },
      ],
    };
    const response = await new NgspiceService(vi.fn()).validate(request);

    expect(response.summary.status).toBe("invalid");
    expect(response.errors.some((error) => error.code === "FLOATING_NODE")).toBe(true);
  });

  it("detects an open circuit before simulation", async () => {
    const response = await new NgspiceService(vi.fn()).validate({
      ...validLedRequest(),
      connections: [
        {
          from: { componentId: "board", pinName: "5V" },
          to: { componentId: "R1", pinName: "1" },
          type: "power",
        },
        {
          from: { componentId: "R1", pinName: "2" },
          to: { componentId: "board", pinName: "A0" },
          type: "analog",
        },
        {
          from: { componentId: "D1", pinName: "anode" },
          to: { componentId: "board", pinName: "A1" },
          type: "analog",
        },
        {
          from: { componentId: "D1", pinName: "cathode" },
          to: { componentId: "board", pinName: "GND" },
          type: "ground",
        },
      ],
    });

    expect(response.summary.status).toBe("invalid");
    expect(response.errors.some((error) => error.code === "OPEN_CIRCUIT")).toBe(true);
  });

  it("detects a direct power short before simulation", async () => {
    const request: NgspiceRequest = {
      ...validLedRequest(),
      components: [],
      connections: [
        {
          from: { componentId: "board", pinName: "5V" },
          to: { componentId: "board", pinName: "GND" },
          type: "power",
        },
      ],
    };

    const response = await new NgspiceService(vi.fn()).validate(request);

    expect(response.summary.status).toBe("invalid");
    expect(response.errors.some((error) => error.code === "SHORT_CIRCUIT")).toBe(true);
  });
});
