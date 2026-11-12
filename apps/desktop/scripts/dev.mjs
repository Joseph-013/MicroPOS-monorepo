// Dev runner: Angular dev server (HMR) + Electron loading it.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

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

const ng = run('pnpm', ['exec', 'ng', 'serve', '--port', String(PORT)]);
ng.on('exit', (code) => shutdown(code ?? 1));

await waitFor(url);

const tsc = run('pnpm', ['build:electron']);
await new Promise((resolve, reject) =>
  tsc.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('electron build failed')))),
).catch((e) => { console.error(e.message); shutdown(1); });

const app = run('pnpm', ['exec', 'electron-forge', 'start'], { ELECTRON_RENDERER_URL: url });
app.on('exit', (code) => shutdown(code ?? 0));
