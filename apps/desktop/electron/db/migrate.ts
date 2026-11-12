import { count } from 'drizzle-orm';
import { type AppDatabase, applyMigrations, createDatabase, SOURCE_MIGRATIONS_FOLDER } from './index';
import { seedDatabase, type SeedSummary } from './factories';
import { type AdminAccount, seedAdmin } from './seeders/admin.seeder';
import { products } from './schema';

export interface MigrateOptions {
  /** Database file. */
  file: string;
  /** Drop every table, then migrate from scratch and create the admin account. */
  fresh?: boolean;
  /** Also run the factories (dummy employees, catalog, sales...). */
  seed?: boolean;
  migrationsFolder?: string;
}

export interface MigrateResult {
  file: string;
  fresh: boolean;
  /** Migrations applied by this run. */
  applied: number;
  /** Set on `--fresh`: the admin account that was created. */
  admin?: AdminAccount;
  seeded?: SeedSummary;
}

/** Number of migrations the database has already run (0 if the tracking table does not exist yet). */
function appliedCount(db: AppDatabase): number {
  const exists = db.$client
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  return exists ? (db.$client.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }).n : 0;
}

/** Drops every table (and with them their indexes), like Laravel's `migrate:fresh`. */
function dropAllTables(db: AppDatabase): void {
  const client = db.$client;
  const tables = client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  client.pragma('foreign_keys = OFF');
  for (const { name } of tables) client.exec(`DROP TABLE IF EXISTS "${name.replaceAll('"', '""')}"`);
  client.pragma('foreign_keys = ON');
}

/**
 * Laravel-style database command.
 *   (no flags)        apply pending migrations
 *   --fresh           drop all tables, migrate from scratch, create one admin account
 *   --seed            also run the factories (refuses a database that already has a catalog)
 *   --fresh --seed    rebuild everything: admin account plus dummy data
 */
export function runMigrate(options: MigrateOptions): MigrateResult {
  const folder = options.migrationsFolder ?? SOURCE_MIGRATIONS_FOLDER;
  const { db, close } = createDatabase(options.file);
  try {
    if (options.fresh) dropAllTables(db);

    const before = appliedCount(db);
    applyMigrations(db, folder);
    const result: MigrateResult = {
      file: options.file,
      fresh: !!options.fresh,
      applied: appliedCount(db) - before,
    };

    if (options.fresh) result.admin = seedAdmin(db);

    if (options.seed) {
      const [{ value }] = db.select({ value: count() }).from(products).all();
      if (value > 0) throw new Error('The database already has data. Use --fresh --seed to rebuild it.');
      result.seeded = seedDatabase(db);
      // The admin was created moments ago in this same run, so its PIN is known.
      if (result.admin?.pin) result.seeded.credentials[0].pin = result.admin.pin;
    }
    return result;
  } finally {
    close();
  }
}
