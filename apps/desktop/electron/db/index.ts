import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema';

/** Drizzle client plus the underlying better-sqlite3 handle (`$client`) for raw statements and pragmas. */
export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export interface CreateDatabaseOptions {
  /** Folder of generated SQL migrations; when given, pending ones are applied on open. */
  migrationsFolder?: string;
}

/**
 * Applies any migrations in `migrationsFolder` that the database has not run yet.
 *
 * Foreign keys are switched off while migrating. SQLite cannot change a column or drop one that has a
 * foreign key in place, so drizzle-kit rebuilds the table (create new, copy, drop old, rename), and with
 * foreign keys on, dropping the old table would cascade-delete or null out rows in tables that point at it.
 * `PRAGMA foreign_keys` is ignored inside a transaction, so it has to be set here, around the migrator.
 * Integrity is checked afterwards, and a violation fails the migration.
 */
export function applyMigrations(db: AppDatabase, migrationsFolder: string): void {
  db.$client.pragma('foreign_keys = OFF');
  try {
    migrate(db, { migrationsFolder });
    const violations = db.$client.pragma('foreign_key_check') as unknown[];
    if (violations.length) throw new Error(`Migration left ${violations.length} foreign key violation(s)`);
  } finally {
    db.$client.pragma('foreign_keys = ON');
  }
}

/**
 * Opens (creating if needed) the SQLite database at `file` and returns a Drizzle client.
 * Main-process only: the renderer reaches the database over IPC. Takes plain paths
 * (no Electron import) so it can be used from tests and scripts.
 */
export function createDatabase(
  file: string,
  options: CreateDatabaseOptions = {},
): { db: AppDatabase; close: () => void } {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema, casing: 'snake_case' });
  if (options.migrationsFolder) {
    try {
      applyMigrations(db, options.migrationsFolder);
    } catch (error) {
      sqlite.close(); // let go of the file, so a caller can move it (an import is rolled back this way)
      throw error;
    }
  }
  return { db, close: () => sqlite.close() };
}

/**
 * Migrations folder when running from source (dev, scripts, tests): apps/desktop/electron/db/migrations.
 * Works both from the TypeScript source and from the compiled output in dist/electron/db.
 */
export const SOURCE_MIGRATIONS_FOLDER = [
  path.resolve(__dirname, 'migrations'),
  path.resolve(__dirname, '..', '..', '..', 'electron', 'db', 'migrations'),
].find((dir) => fs.existsSync(path.join(dir, 'meta', '_journal.json'))) ?? path.resolve(__dirname, 'migrations');
