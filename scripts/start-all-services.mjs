import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const logsDir = path.join(workspaceRoot, '.logs');
mkdirSync(logsDir, { recursive: true });

const serviceEntries = [
  ['gateway', 'pnpm --filter @wireup/gateway dev'],
  ['orchestrator', 'pnpm --filter @wireup/orchestrator dev'],
  ['rag', 'pnpm --filter @wireup/rag dev'],
  ['planner', 'pnpm --filter @wireup/planner dev'],
  ['generator', 'pnpm --filter @wireup/generator dev'],
  ['validator', 'pnpm --filter @wireup/validator dev'],
  ['simulator', 'pnpm --filter @wireup/simulator dev'],
  ['storage', 'pnpm --filter @wireup/storage dev'],
  ['context-builder', 'pnpm --filter @wireup/context-builder dev'],
  ['ngspice', 'pnpm --filter @wireup/ngspice dev'],
];

for (const [serviceName, command] of serviceEntries) {
  const child = spawn(command, {
    cwd: workspaceRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GATEWAY_PORT: '3000',
      ORCHESTRATOR_PORT: '3001',
      RAG_PORT: '3002',
      PLANNER_PORT: '3003',
      GENERATOR_PORT: '3004',
      VALIDATOR_PORT: '3005',
      SIMULATOR_PORT: '3006',
      STORAGE_PORT: '3007',
      CONTEXT_BUILDER_PORT: '3008',
      NGSPICE_PORT: '3009',
    },
  });

  const logPath = path.join(logsDir, `${serviceName}.log`);
  const logFile = createWriteStream(logPath, { flags: 'a' });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${serviceName}] ${chunk}`);
    logFile.write(chunk);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${serviceName}] ${chunk}`);
    logFile.write(chunk);
  });

  child.on('exit', (code) => {
    logFile.end();
    if (code !== 0) {
      console.error(`${serviceName} exited with code ${code}`);
    }
  });
}
