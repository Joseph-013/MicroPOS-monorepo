import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * Windows installer events (Squirrel runs the app with `--squirrel-*` while installing, updating and uninstalling).
 * Without answering them the app would open a window during setup and no Start menu or desktop shortcut would be
 * made or removed. Returns true when the arguments were an installer event: the app must then quit at once.
 */
export function handleSquirrelEvent(argv: string[], execPath: string, platform: string = process.platform): boolean {
  const event = argv[1];
  if (platform !== 'win32' || !event?.startsWith('--squirrel-')) return false;
  const updateExe = path.resolve(path.dirname(execPath), '..', 'Update.exe');
  const exeName = path.basename(execPath);
  switch (event) {
    case '--squirrel-install':
    case '--squirrel-updated':
      spawnSync(updateExe, ['--createShortcut', exeName]);
      return true;
    case '--squirrel-uninstall':
      spawnSync(updateExe, ['--removeShortcut', exeName]);
      return true;
    case '--squirrel-obsolete':
      return true;
    default:
      return false; // --squirrel-firstrun: a normal start
  }
}
