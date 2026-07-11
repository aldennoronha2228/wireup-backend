import { describe, expect, it } from "vitest";
import { NgspiceService } from "./service.js";

describe("NgspiceService", () => {
  it("returns a local validation response for a basic circuit request", async () => {
    const service = new NgspiceService(async () => ({
      exitCode: 0,
      stdout: "Node Voltages\n  vcc_rail 5.000E+00\n",
      stderr: "",
    }));

    const response = await service.validate({
      circuitId: "test-circuit",
      components: [
        {
          id: "led-1",
          name: "LED",
          type: "LED",
          specifications: { voltage: 5 },
        },
      ],
      connections: [],
      board: { platform: "arduino", voltage: 5 },
    });

    expect(response.summary.status).toBe("invalid");
    expect(response.errors.some((error) => error.code === "MISSING_GROUND")).toBe(true);
  });
});
