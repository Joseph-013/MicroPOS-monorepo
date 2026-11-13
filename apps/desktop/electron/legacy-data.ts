import fs from 'node:fs';
import path from 'node:path';

/** File in the user data folder that says this app owns it. Without it, whatever is there belongs to something older. */
export const DATA_MARKER = 'micropos-data.json';
/** Bump to wipe again on a future install that must start clean. */
export const DATA_GENERATION = 1;

export type PurgeResult =
  /** The folder was already this app's: nothing touched. */
  | { state: 'current' }
  /** An empty or new folder: claimed, nothing to remove. */
  | { state: 'fresh' }
  /** Older data was found and removed (`failed` lists entries that could not be, for example because they were in use). */
  | { state: 'purged'; removed: string[]; failed: string[] };

/**
 * Makes the user data folder this app's own. An earlier MicroPOS installed under the same name keeps its database,
 * logs, logo and browser storage in the same folder, and its database has a different schema history, so it must not
 * be opened. The first time this app starts there, everything in the folder is removed and a marker is written; after
 * that the folder is left alone. Run it before the database is opened (and before the window, which opens browser
 * storage). Entries that cannot be removed are reported in `failed`, not thrown.
 */
export function purgeLegacyData(userData: string): PurgeResult {
  fs.mkdirSync(userData, { recursive: true });
  const markerFile = path.join(userData, DATA_MARKER);
  try {
    const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8')) as { generation?: unknown };
    if (typeof marker.generation === 'number' && marker.generation >= DATA_GENERATION) return { state: 'current' };
  } catch {
    // No marker (or an unreadable one): the folder is not ours yet.
  }

  const removed: string[] = [];
  const failed: string[] = [];
  for (const entry of fs.readdirSync(userData)) {
    if (entry === DATA_MARKER) continue;
    try {
      fs.rmSync(path.join(userData, entry), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      removed.push(entry);
    } catch {
      failed.push(entry);
    }
  }
  fs.writeFileSync(markerFile, JSON.stringify({ generation: DATA_GENERATION, claimedAt: new Date().toISOString() }));
  return removed.length || failed.length ? { state: 'purged', removed, failed } : { state: 'fresh' };
}
