import { describe, expect, it } from "vitest";
import { parseNgspiceOutput } from "./parser.js";

describe("parseNgspiceOutput", () => {
  it("parses NGSpice op tables from the bundled Windows executable", () => {
    const output = `
Circuit: * wireup ngspice netlist

Doing analysis at TEMP = 27.000000 and TNOM = 27.000000

No. of Data Rows : 1
\tNode                                  Voltage
\t----                                  -------
\t----\t-------
\tn0                               5.000000e+00
\tvcc_rail                         5.000000e+00

\tSource\tCurrent
\t------\t-------

\tv_vcc#branch                     0.000000e+00

 Resistor models (Simple linear resistor)
        rsh                     0
`;

    expect(parseNgspiceOutput(output)).toEqual({
      voltages: {
        n0: 5,
        vcc_rail: 5,
      },
      currents: {
        "v_vcc#branch": 0,
        v_vcc: 0,
      },
      warnings: [],
    });
  });
});
