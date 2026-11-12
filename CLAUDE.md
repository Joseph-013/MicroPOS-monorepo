# MicroPOS

pnpm monorepo (Node 24, pnpm via corepack). Business logic is shared across all apps.

## Layout
- `packages/core` (`@micropos/core`): pure TypeScript business logic (pricing, tax, cart, validation, types). Used by every app.
- `apps/desktop` (`@micropos/desktop`): Electron Forge 8 + Angular 22 renderer. Local SQLite via better-sqlite3 (not yet added). See its CLAUDE.md.
- `apps/mobile`: React Native (planned).
- `apps/web`: placeholder for the NestJS backend (planned; likely to be renamed `apps/api`). The only app that is containerized.

Each app gets its own CLAUDE.md with app-specific notes once scaffolded.

## Commands
- `pnpm install` (root only; never install inside an app with npm/yarn)
- `pnpm -r build` / `pnpm test` / `pnpm typecheck`
- `pnpm --filter <package-name> <script>` to target one package
- Docker: `docker build -f apps/web/Dockerfile .` (context is the repo root) or `docker compose up`

## Rules
- `packages/core` must stay pure: no Node, DOM, Electron, React Native or framework imports. Platform specifics go behind interfaces implemented in the apps (e.g. storage).
- Money is integer minor units (cents). Never use floats for currency.
- Apps consume core's compiled `dist/`. Rebuild core (`pnpm --filter @micropos/core build`) after changing it.
- Core is ESM with NodeNext: relative imports inside it need `.js` extensions.
- Depend on core with `"@micropos/core": "workspace:*"`.
- better-sqlite3 is used only in Electron's main process; the renderer reaches it over IPC. Mobile cannot use it.

## Config notes
- `nodeLinker: hoisted` in `pnpm-workspace.yaml` (pnpm 12 ignores `node-linker` in `.npmrc`; the `.npmrc` line is kept for older tooling). Needed so Electron Forge can find native modules and Metro can resolve workspace packages. Don't remove it without testing desktop packaging.
- `.dockerignore` excludes `apps/desktop` and `apps/mobile`; only the API is built into images.
- Node version is pinned in `.nvmrc`; pnpm in `package.json` `packageManager`.
