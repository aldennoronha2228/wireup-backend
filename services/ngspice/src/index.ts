import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { NgspiceRequestSchema, type NgspiceResponse } from "./schema.js";
import { buildNetlist } from "./netlist.js";
import { parseNgspiceOutput } from "./parser.js";
import { runNgspice } from "./ngspice.js";
import { analyzeCircuit } from "./analyze.js";
import {
  createCommonMiddleware,
  createLogger,
  createMetricsCollector,
  getRuntimeConfig,
  registerGracefulShutdown,
  registerHealthRoutes,
  registerMetricsRoute,
} from "@wireup/utils";

const serviceName = "ngspice";
const runtimeConfig = getRuntimeConfig(serviceName);
const logger = createLogger(serviceName);
const metrics = createMetricsCollector();

const app = new Hono();

app.use("*", cors());
app.use("*", ...createCommonMiddleware(runtimeConfig, logger, metrics));

app.post("/api/ngspice/validate", async (c) => {
  const body = await c.req.json();
  const parsed = NgspiceRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        errors: [
          {
            code: "VALIDATION_ERROR",
            message: "Invalid ngspice request",
            details: parsed.error.flatten(),
          },
        ],
        warnings: [],
        voltages: {},
        currents: {},
        summary: {
          status: "invalid",
          totalErrors: 1,
          totalWarnings: 0,
          ngspiceExitCode: null,
        },
      } satisfies NgspiceResponse,
      400,
    );
  }

  const { netlist, powerVoltage } = buildNetlist(parsed.data);
  const issues = {
    errors: [] as NgspiceResponse["errors"],
    warnings: [] as NgspiceResponse["warnings"],
  };

  if (!netlist) {
    issues.errors.push({
      code: "NETLIST_EMPTY",
      message: "Netlist could not be generated",
    });
  }

  const result = await runNgspice(netlist);
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const parsedOutput = parseNgspiceOutput(output);

  if (result.exitCode !== 0) {
    issues.errors.push({
      code: "NGSPICE_FAILED",
      message: "ngspice execution failed",
      details: { output },
    });
  }

  parsedOutput.warnings.forEach((warning) => {
    issues.warnings.push({
      code: "NGSPICE_WARNING",
      message: warning,
    });
  });

  if (Object.keys(parsedOutput.voltages).length === 0) {
    issues.warnings.push({
      code: "NO_VOLTAGES",
      message: "ngspice produced no voltage data",
    });
  }

  const analysis = analyzeCircuit(
    parsed.data,
    output,
    parsedOutput.voltages,
    parsedOutput.currents,
  );

  issues.errors.push(...analysis.errors);
  issues.warnings.push(...analysis.warnings);

  const summary = {
    status: issues.errors.length === 0 ? "valid" : "invalid",
    totalErrors: issues.errors.length,
    totalWarnings: issues.warnings.length,
    ngspiceExitCode: result.exitCode,
    powerVoltage,
    suggestedFixes: analysis.suggestedFixes,
  };

  return c.json({
    errors: issues.errors,
    warnings: issues.warnings,
    voltages: parsedOutput.voltages,
    currents: parsedOutput.currents,
    summary,
  } satisfies NgspiceResponse);
});

registerHealthRoutes(app, serviceName);
registerMetricsRoute(app, metrics, serviceName);

const port = runtimeConfig.port;
logger.info("service_starting", { port });

const server = serve({
  fetch: app.fetch,
  port,
});

registerGracefulShutdown(server as any, logger);
