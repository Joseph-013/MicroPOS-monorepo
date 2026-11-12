/**
 * Database command (Laravel-style). From the repo root or apps/desktop:
 *   pnpm db:migrate                  apply pending migrations
 *   pnpm db:migrate --fresh          drop all tables, migrate, create one admin account
 *   pnpm db:migrate --fresh --seed   ...and run the factories (dummy data)
 *   pnpm db:seed                     run the factories only (needs an empty catalog)
 * Options: --database=<file> to use another database file.
 * Default file: apps/desktop/local-data/micropos-dev.db, the same one the dev app opens.
 */
import path from 'node:path';
import { runMigrate } from './migrate';

/** apps/desktop, wherever the command was started from (this file is in dist/electron/db). */
const DESKTOP_DIR = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_FILE = path.join(DESKTOP_DIR, 'local-data', 'micropos-dev.db');

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const database = args.find((a) => a.startsWith('--database='))?.slice('--database='.length);
const unknown = args.filter((a) => !['--fresh', '--seed'].includes(a) && !a.startsWith('--database='));

if (unknown.length) {
  console.error(`Unknown option(s): ${unknown.join(' ')}\nUsage: pnpm db:migrate [--fresh] [--seed] [--database=<file>]`);
  process.exit(2);
}

try {
  const result = runMigrate({
    file: database ? path.resolve(database) : DEFAULT_FILE,
    fresh: flag('fresh'),
    seed: flag('seed'),
  });

  console.log(`${result.fresh ? 'Rebuilt' : 'Migrated'} ${result.file}`);
  console.log(result.applied ? `Applied ${result.applied} migration(s).` : 'Nothing to migrate.');
  if (result.admin?.created) {
    console.log(
      `Admin account: employee number ${result.admin.employeeNumber}, PIN ${result.admin.pin} (set MICROPOS_ADMIN_PIN to choose another).`,
    );
  }
  if (result.seeded) {
    const { credentials, ...counts } = result.seeded;
    console.table(counts);
    console.log('Sign-ins (dummy PIN is for dev data only):');
    console.table(credentials);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
