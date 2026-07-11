import { describe, expect, it } from "vitest";
import { buildPlan } from "./planner.js";

const sampleContext = [
  {
    id: "ctx-1",
    type: "vector" as const,
    content: "Use an ESP32 with temperature and humidity sensors.",
    metadata: {},
    score: 0.9,
  },
];

describe("buildPlan", () => {
  it("produces deterministic output", () => {
    const first = buildPlan({
      prompt: "Build a temperature monitor with ESP32.",
      ragContext: sampleContext,
    });
    const second = buildPlan({
      prompt: "Build a temperature monitor with ESP32.",
      ragContext: sampleContext,
    });

    expect(first).toEqual(second);
    expect(first.hardwarePlatform.type).toBe("esp32");
    expect(first.libraries.length).toBeGreaterThan(0);
  });

  it("avoids markdown in string outputs", () => {
    const result = buildPlan({
      prompt: "Read temperature and control a relay.",
      ragContext: [],
    });

    const stringFields = [
      ...result.projectRequirements,
      ...result.firmwareGoals,
      result.wiringStrategy,
      ...result.wiringPlan.notes,
    ];

    stringFields.forEach((value) => {
      expect(value).not.toMatch(/```/);
      expect(value).not.toMatch(/^\s*[-*#]/);
    });
  });
});
