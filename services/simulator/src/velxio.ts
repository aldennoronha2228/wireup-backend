import WebSocket from "ws";
import { randomUUID } from "crypto";
import type {
  ExecutionLog,
  GeneratorResponse,
  PinValue,
  SensorValue,
  SimulatorResponse,
  SimulationStatus,
} from "@wireup/types";
import type { VelxioAssets } from "./velxio-adapter.js";

export interface VelxioConfig {
  baseUrl: string;
  compileUrl: string;
  simulationWindowMs: number;
}

interface VelxioCompileResponse {
  success: boolean;
  hex_content?: string | null;
  binary_content?: string | null;
  binary_type?: string | null;
  stdout?: string;
  stderr?: string;
  error?: string | null;
}

interface VelxioEvent {
  type: string;
  data: Record<string, unknown>;
}

const now = () => Date.now();

const logEntry = (level: ExecutionLog["level"], message: string): ExecutionLog => ({
  timestamp: now(),
  level,
  message,
});

const detectBoard = (generatorOutput: GeneratorResponse) => {
  const tag = generatorOutput.projectMetadata.tags.find((value) =>
    ["esp32", "stm32", "raspberry", "arduino"].some((key) => value.includes(key)),
  );
  const platform = tag?.toLowerCase() || "arduino";

  if (platform.includes("esp32")) {
    return { platform: "esp32", fqbn: "esp32:esp32:esp32" };
  }
  if (platform.includes("stm32")) {
    return { platform: "stm32", fqbn: "stm32:stm32:bluepill" };
  }
  if (platform.includes("raspberry")) {
    return { platform: "raspberry", fqbn: "rpi:pico" };
  }
  return { platform: "arduino", fqbn: "arduino:avr:uno" };
};

const compileFirmware = async (
  config: VelxioConfig,
  generatorOutput: GeneratorResponse,
) => {
  const firmware = generatorOutput.firmware;
  const board = detectBoard(generatorOutput);

  const response = await fetch(config.compileUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: [{ name: "sketch.ino", content: firmware.code }],
      board_fqbn: board.fqbn,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return { success: false, error: errorText };
  }

  return (await response.json()) as VelxioCompileResponse;
};

const collectSimulationEvents = (
  ws: WebSocket,
  windowMs: number,
): Promise<VelxioEvent[]> =>
  new Promise((resolve) => {
    const events: VelxioEvent[] = [];
    const timer = setTimeout(() => {
      ws.close();
      resolve(events);
    }, windowMs);

    ws.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString()) as VelxioEvent;
        events.push(event);
      } catch {
        // ignore malformed payloads
      }
    });

    ws.on("close", () => {
      clearTimeout(timer);
      resolve(events);
    });
  });

const mapVelxioEvents = (events: VelxioEvent[]) => {
  const pinValues: Record<string, PinValue[]> = {};
  const sensorValues: Record<string, SensorValue[]> = {};
  const executionLogs: ExecutionLog[] = [];
  const serialMonitor: SensorValue[] = [];

  events.forEach((event) => {
    if (event.type === "gpio_change") {
      const pin = String(event.data.pin ?? "unknown");
      const state = Boolean(event.data.state);
      if (!pinValues[pin]) pinValues[pin] = [];
      pinValues[pin].push({ timestamp: now(), value: state });
    } else if (event.type === "serial_output") {
      const text = String(event.data.data ?? "");
      executionLogs.push(logEntry("info", `serial: ${text}`));
      serialMonitor.push({ timestamp: now(), value: { text } });
    } else if (event.type === "sensor_update") {
      const sensor = String(event.data.sensor ?? "sensor");
      if (!sensorValues[sensor]) sensorValues[sensor] = [];
      sensorValues[sensor].push({ timestamp: now(), value: event.data });
    } else if (event.type === "error") {
      executionLogs.push(
        logEntry("error", String(event.data.message ?? "Velxio error")),
      );
    } else {
      executionLogs.push(logEntry("debug", `event:${event.type}`));
    }
  });

  if (serialMonitor.length > 0) {
    sensorValues.serial_monitor = serialMonitor;
  }

  return { pinValues, sensorValues, executionLogs };
};

export const runVelxioSimulation = async (
  config: VelxioConfig,
  generatorOutput: GeneratorResponse,
  assets: VelxioAssets,
): Promise<SimulatorResponse> => {
  const simulationId = randomUUID();
  const executionLogs: ExecutionLog[] = [
    logEntry("info", "Velxio simulation started"),
    logEntry("debug", `diagram:${JSON.stringify(assets.circuitDiagram)}`),
    logEntry("debug", `wiring:${JSON.stringify(assets.wiringDiagram)}`),
  ];

  const board = detectBoard(generatorOutput);

  if (generatorOutput.firmware.language === "python") {
    return {
      simulationId,
      status: "error" as SimulationStatus,
      pinValues: {},
      sensorValues: {},
      executionLogs: executionLogs.concat(
        logEntry("error", "python_firmware_not_supported_by_velxio_backend"),
      ),
    };
  }

  if (![
    "esp32",
    "stm32",
  ].includes(board.platform)) {
    return {
      simulationId,
      status: "error" as SimulationStatus,
      pinValues: {},
      sensorValues: {},
      executionLogs: executionLogs.concat(
        logEntry("error", `unsupported_board:${board.platform}`),
      ),
    };
  }

  const compileResult = await compileFirmware(config, generatorOutput);
  if (!compileResult.success) {
    return {
      simulationId,
      status: "error" as SimulationStatus,
      pinValues: {},
      sensorValues: {},
      executionLogs: executionLogs.concat(
        logEntry("error", `compile_failed:${compileResult.error || "unknown"}`),
      ),
    };
  }

  const firmwareB64 = compileResult.binary_content || compileResult.hex_content;
  if (!firmwareB64) {
    return {
      simulationId,
      status: "error" as SimulationStatus,
      pinValues: {},
      sensorValues: {},
      executionLogs: executionLogs.concat(
        logEntry("error", "compile_success_without_artifact"),
      ),
    };
  }

  const wsUrl = `${config.baseUrl.replace("http", "ws")}/api/simulation/ws/${simulationId}`;
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", (err) => reject(err));
  });

  const startMessage =
    board.platform === "stm32"
      ? {
          type: "start_stm32",
          data: { board: "stm32-bluepill", firmware_b64: firmwareB64, sensors: [] },
        }
      : {
          type: "start_esp32",
          data: {
            board: "esp32",
            firmware_b64: firmwareB64,
            sensors: [],
            wifi_enabled: false,
          },
        };

  ws.send(JSON.stringify(startMessage));

  const events = await collectSimulationEvents(ws, config.simulationWindowMs);
  const mapped = mapVelxioEvents(events);
  const diagramValue = { diagram: assets.circuitDiagram };
  const wiringValue = { wiring: assets.wiringDiagram };

  mapped.sensorValues.diagram = [
    { timestamp: now(), value: diagramValue },
  ];
  mapped.sensorValues.wiring = [
    { timestamp: now(), value: wiringValue },
  ];

  ws.send(
    JSON.stringify({
      type: board.platform === "stm32" ? "stop_stm32" : "stop_esp32",
      data: {},
    }),
  );
  ws.close();

  return {
    simulationId,
    status: "completed" as SimulationStatus,
    pinValues: mapped.pinValues,
    sensorValues: mapped.sensorValues,
    executionLogs: executionLogs.concat(mapped.executionLogs),
  };
};
