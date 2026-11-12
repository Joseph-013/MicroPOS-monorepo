import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './electron/db/schema.ts',
  out: './electron/db/migrations',
  casing: 'snake_case',
  // Used by `drizzle-kit studio` / `push` only; the app opens its DB under Electron's userData.
  dbCredentials: { url: './local-data/micropos-dev.db' },
});
