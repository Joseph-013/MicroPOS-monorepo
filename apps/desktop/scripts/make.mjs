// `pnpm make` (after `pnpm build`): the installers for the machine building.
// Windows: Electron Forge packages the app, then Inno Setup (installer/micropos.iss) wraps it in a setup wizard,
//   out/make/inno/MicroPOS-<version>-setup.exe. Needs Inno Setup 6 (`winget install JRSoftware.InnoSetup`); set
//   INNO_SETUP_COMPILER to ISCC.exe if it is installed somewhere else.
// Elsewhere: `electron-forge make` with the makers in forge.config.js (zip and rpm on Linux).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function run(command, args) {
  // pnpm is a .cmd script on Windows, which needs a shell (given one command line; its arguments here are fixed words).
  const viaShell = process.platform === 'win32' && command === 'pnpm';
  const result = viaShell
    ? spawnSync([command, ...args].join(' '), { cwd: root, stdio: 'inherit', shell: true })
    : spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findIscc() {
  const candidates = [
    process.env.INNO_SETUP_COMPILER,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Inno Setup 6', 'ISCC.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Inno Setup 6', 'ISCC.exe'),
  ].filter(Boolean);
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) {
    console.error(`Inno Setup 6 not found (looked in: ${candidates.join(', ')}).\nInstall it with: winget install JRSoftware.InnoSetup`);
    process.exit(1);
  }
  return found;
}

if (process.platform !== 'win32') {
  run('pnpm', ['exec', 'electron-forge', 'make']);
} else {
  const iscc = findIscc(); // before packaging, so a missing compiler fails fast
  run('pnpm', ['exec', 'electron-forge', 'package', '--arch=x64']);
  const outputDir = path.join(root, 'out', 'make', 'inno');
  run(iscc, [
    '/Q',
    `/DAppVersion=${version}`,
    `/DSourceDir=${path.join(root, 'out', 'MicroPOS-win32-x64')}`,
    `/DOutputDir=${outputDir}`,
    `/DIconFile=${path.join(root, 'assets', 'icon.ico')}`,
    `/DOldCleanup=${path.join(root, '..', '..', 'remove-old-micropos.ps1')}`,
    path.join(root, 'installer', 'micropos.iss'),
  ]);
  console.log(`Installer: ${path.join(outputDir, `MicroPOS-${version}-setup.exe`)}`);
}
