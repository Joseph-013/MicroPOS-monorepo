import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema';

/**
 * Opens (creating if needed) the SQLite database at `file` and returns a Drizzle client.
 * Main-process only: the renderer reaches the database over IPC. Takes a plain path
 * (no Electron import) so it can be used from tests and scripts.
 */
export type AppDatabase = BetterSQLite3Database<typeof schema>;

export function createDatabase(file: string): { db: AppDatabase; close: () => void } {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema, casing: 'snake_case' });
  return { db, close: () => sqlite.close() };
}
