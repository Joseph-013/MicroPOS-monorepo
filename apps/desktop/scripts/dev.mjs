// Dev runner: Angular dev server (HMR) + Electron loading it.
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4200;
const url = `http://localhost:${PORT}`;
const children = [];
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function run(cmd, args, env = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', detached: true, env: { ...process.env, ...env } });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const c of children) {
    try {
      process.kill(-c.pid); // whole process group, so pnpm wrappers don't orphan ng/electron
    } catch {}
  }
  process.exit(code);
}

async function waitFor(target, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(target)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${target}`);
}

// The dev server pre-bundles @micropos/core into .angular/cache and does not notice when core is rebuilt, so the
// page kept running an old DESKTOP_API_VERSION and showed "out of date". Dropping the pre-bundle each start is cheap.
rmSync('.angular/cache', { recursive: true, force: true });

// Linux taskbars take a window's icon from the launcher entry matching its app id. The dev app announces
// `micropos-dev` (see electron/main.ts), so write that entry, pointing at the app icon in the repo. Hidden from the
// application menu (NoDisplay); only the taskbar uses it. Safe to run every start.
if (process.platform === 'linux') {
  try {
    const dir = path.join(homedir(), '.local', 'share', 'applications');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'micropos-dev.desktop'),
      `[Desktop Entry]\nType=Application\nName=MicroPOS (dev)\nIcon=${path.join(ROOT, 'assets', 'icon.png')}\nExec=${path.join(ROOT, '..', '..', 'node_modules', 'electron', 'dist', 'electron')} ${ROOT}\nStartupWMClass=micropos-dev\nNoDisplay=true\n`,
    );
    // Let KDE notice the new entry now rather than at the next login (best effort; not every desktop has it).
    for (const tool of ['kbuildsycoca6', 'kbuildsycoca5']) {
      try {
        execFileSync(tool, [], { stdio: 'ignore' });
        break;
      } catch {}
    }
  } catch (error) {
    console.warn('Could not write the dev launcher entry (the taskbar icon will be generic):', error.message);
  }
}

await import('./copy-zxing.mjs');
const ng = run('pnpm', ['exec', 'ng', 'serve', '--port', String(PORT)]);
ng.on('exit', (code) => shutdown(code ?? 1));

await waitFor(url);

const tsc = run('pnpm', ['build:electron']);
await new Promise((resolve, reject) =>
  tsc.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('electron build failed')))),
).catch((e) => { console.error(e.message); shutdown(1); });

const app = run('pnpm', ['exec', 'electron-forge', 'start'], { ELECTRON_RENDERER_URL: url });
app.on('exit', (code) => shutdown(code ?? 0));
