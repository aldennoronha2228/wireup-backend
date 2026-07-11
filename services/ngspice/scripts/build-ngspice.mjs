import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..', '..');
const ngspiceDir = resolve(rootDir, 'vendor', 'ngspice');
const buildDir = resolve(ngspiceDir, 'build');

mkdirSync(buildDir, { recursive: true });

if (process.platform === 'win32') {
  const result = spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', resolve(__dirname, 'build-ngspice.ps1')], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  process.exit(0);
}

const configureExists = existsSync(resolve(ngspiceDir, 'configure'));
if (!configureExists) {
  const autogen = spawnSync('sh', ['autogen.sh'], { cwd: ngspiceDir, stdio: 'inherit' });
  if (autogen.status !== 0) process.exit(autogen.status ?? 1);
}

const configure = spawnSync('../configure', ['--enable-xspice', '--disable-debug', '--with-ngshared', `--prefix=${resolve(buildDir, 'dist')}`], {
  cwd: buildDir,
  stdio: 'inherit',
  shell: true,
});
if (configure.status !== 0) process.exit(configure.status ?? 1);

const make = spawnSync('make', ['-j2'], { cwd: buildDir, stdio: 'inherit' });
if (make.status !== 0) process.exit(make.status ?? 1);

const install = spawnSync('make', ['install'], { cwd: buildDir, stdio: 'inherit' });
if (install.status !== 0) process.exit(install.status ?? 1);
