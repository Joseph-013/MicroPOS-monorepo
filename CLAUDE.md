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
- `pnpm make:desktop`: build core and theme, then package the desktop installers (an Inno Setup wizard `MicroPOS-<version>-setup.exe` on Windows, which needs Inno Setup 6; rpm and zip on Linux) into `apps/desktop/out/make/`
- `pnpm --filter <package-name> <script>` to target one package
- Database (desktop, Laravel-style): `pnpm db:migrate [--fresh] [--seed]`, `pnpm db:seed`, `pnpm db:generate`; see `apps/desktop/CLAUDE.md`.
- Docker: `docker build -f apps/web/Dockerfile .` (context is the repo root) or `docker compose up`

## Rules
- `packages/core` must stay pure: no Node, DOM, Electron, React Native or framework imports. Platform specifics go behind interfaces implemented in the apps (e.g. storage).
- Money is integer minor units (cents). Never use floats for currency.
- Apps consume core's compiled `dist/`. Rebuild core (`pnpm --filter @micropos/core build`) after changing it.
- Core is ESM with NodeNext: relative imports inside it need `.js` extensions.
- Depend on core with `"@micropos/core": "workspace:*"`.
- better-sqlite3 is used only in Electron's main process; the renderer reaches it over IPC. Mobile cannot use it.
- Whenever the system changes (a new page, feature, setting, IPC call or action), check whether permissions need updating: a new `Permission` or preset entry in `packages/core/src/auth.ts`, a `guarded()` channel in `electron/ipc/index.ts`, a route `requires()` and a nav entry. Details in `apps/desktop/CLAUDE.md` (Users and permissions).
- Always check new or changed UI for overflow before calling it done, and fix it proactively: long names and values, many rows, large quantities and amounts, narrow windows, large text and the on-screen keyboard. Truncate with `min-w-0` + `truncate`, wrap, scroll inside the container, or let the element grow within a sensible maximum; never let content push a layout wider than the window or hide a button.
- Every update of the desktop app bumps `version` in `apps/desktop/package.json` in the same change (patch fix, minor feature, major breaking or data reset); the Windows installer only upgrades to a higher version. Claude makes the bump (and names the version in its report) without being asked. Details in `apps/desktop/CLAUDE.md`.

## Docs
- `docs/erd.mmd` is the source for the database ERD (Mermaid) and `docs/erd.png` is the rendered image. Whenever the database schema changes (Drizzle schema in `apps/desktop/electron/db/schema.ts` or its migrations), update `docs/erd.mmd` and regenerate `docs/erd.png` in the same change. Also check the dummy-data factories (`apps/desktop/electron/db/factories/`) and update them if the change affects them; see `apps/desktop/CLAUDE.md`.

## Config notes
- `nodeLinker: hoisted` in `pnpm-workspace.yaml` (pnpm 12 ignores `node-linker` in `.npmrc`; the `.npmrc` line is kept for older tooling). Needed so Electron Forge can find native modules and Metro can resolve workspace packages. Don't remove it without testing desktop packaging.
- `.dockerignore` excludes `apps/desktop` and `apps/mobile`; only the API is built into images.
- Node version is pinned in `.nvmrc`; pnpm in `package.json` `packageManager`.
