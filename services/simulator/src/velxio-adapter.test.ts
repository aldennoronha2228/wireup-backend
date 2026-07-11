import assert from "node:assert/strict";
import test from "node:test";
import type { SimulationJson } from "@wireup/types";
import { buildVelxioCircuitFromSimulationJson } from "./velxio-adapter.js";

test("buildVelxioCircuitFromSimulationJson maps simulation components into Velxio circuit assets", async () => {
  const simulationJson: SimulationJson = {
    version: "1",
    components: [
      {
        id: "led1",
        type: "led",
        properties: { color: "red" },
        position: { x: 10, y: 20 },
      },
      {
        id: "button1",
        type: "pushbutton",
        properties: {},
        position: { x: 30, y: 40 },
      },
    ],
    connections: [
      {
        from: { componentId: "button1", pin: "D2" },
        to: { componentId: "led1", pin: "A" },
      },
    ],
    setup: {
      timeStep: 1,
      duration: 5,
    },
  };

  const circuit = await buildVelxioCircuitFromSimulationJson(simulationJson);

  assert.equal(circuit.components.length, 2);
  assert.equal(circuit.components[0].type, "wokwi-led");
  assert.equal(circuit.connections[0].from_part, "button1");
  assert.equal(circuit.connections[0].to_part, "led1");
});
