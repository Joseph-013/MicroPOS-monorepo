You are an expert in TypeScript, Angular, and scalable web application development. You write functional, maintainable, performant, and accessible code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Do NOT set `changeDetection: ChangeDetectionStrategy.OnPush` explicitly. `OnPush` is the default in Angular v22+.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Accessibility Requirements

- It MUST pass all AXE checks.
- It MUST follow all WCAG AA minimums, including focus management, color contrast, and ARIA attributes.

## Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `model()` for two-way bound properties with `[(prop)]` syntax instead of pairing `input()` with `output()`
- Use `computed()` for derived state
- Use `linkedSignal()` for state derived from multiple reactive sources that must stay synchronized
- Prefer inline templates for small components
- Prefer Signal Forms (`@angular/forms/signals`) for new forms. They are stable in Angular v22+ and provide signal-based state, type-safe field access, and schema-based validation
- When not using Signal Forms, prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead
- Do NOT import `CommonModule`, import only the directives and pipes the template uses, such as `AsyncPipe` or `DatePipe`
- When using external templates/styles, use paths relative to the component TS file.

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- Do not assume globals like (`new Date()`) are available.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Prefer the `@Service` decorator over `@Injectable({providedIn: 'root'})` for new singleton services (Angular v22+)
- Use the `inject()` function instead of constructor injection

## Electron / Forge (MicroPOS)

- Renderer: Angular, built to `dist/renderer` (`pnpm build:renderer`). No `<base href>` (a base tag makes the hash router rewrite the URL to the folder, which breaks reload over `file://`).
- Main/preload: `electron/*.ts`, compiled with `tsc -p tsconfig.electron.json` to `dist/electron` (CommonJS). `package.json` `main` points at `dist/electron/main.js`.
- Commands: `pnpm --filter @micropos/desktop start | build | package | make | typecheck | test`.
- DevTools open automatically, docked inside the window, whenever the app is not packaged (`!app.isPackaged`, covers `pnpm dev` and `pnpm start`); packaged builds never open them.
- Renderer has no Node access (contextIsolation, sandbox). The preload runs sandboxed and cannot `require` local files, so `build:electron` bundles `electron/preload.ts` into one file with esbuild after `tsc`. Keep the sandbox on; never import Node modules in the preload.
- Angular and `@micropos/core` are bundled into the renderer, so they live in `devDependencies`. `forge.config.js` sets `prune: false` and excludes `node_modules` because Forge's dependency walker can't resolve hoisted workspace deps. When adding native runtime deps (better-sqlite3), they must be shipped and unpacked from the asar; revisit this config then.
- Not containerized (see `.dockerignore`).

## UI conventions (MicroPOS)

- Copy: titles and labels are short, professional, sentence case ("Checkout", "Sales Orders"). No descriptions, subtitles or helper text unless critically necessary, e.g. confirmation dialogs.
- Shape: square and boxy everywhere. No `rounded-*` classes; the theme radius is 0. Only radio buttons stay circular (as in the design). Dialogs are square with the `blueprint` corner marks; only confirmation (alert) dialogs carry a description.
- Scrollbars are styled globally in `styles.css` (slim, square, no arrows); don't restyle them per component.
- Keep borders minimal: corner marks (`blueprint`) are for large panels only. Repeated items (grid cells, list rows) get a single hairline border with no marks and no outlined tags (`before:hidden`, `tagNeutral`).
- Space is at a premium: keep page padding tight (main content uses `p-3`) and put titles close to the edges.
- Styles are plain CSS (Tailwind v4 via PostCSS), not Sass; global styles live in `src/styles.css`.
- Kiosk behavior: text selection is off app-wide (`html { user-select: none }` in `styles.css`). Inputs and textareas stay selectable; opt other text in with Tailwind `select-text` or `select-all` (order numbers, receipt text, error messages).
- Minimum window is 1024 × 600 (`MIN_WINDOW` in `core/viewport/too-small-overlay.ts`); below it a full-window warning covers the app. Design layouts for that minimum.
- Touch sizing lives at the root: `--control-height` (44px), `--control-height-sm` (36px), `--control-height-lg` (56px) and `--popup-offset` in `src/styles.css`. Buttons, inputs, selects, tabs, and menu/list rows read them, so one edit resizes the app. Do not set `h-*`/`size-*` on a control in a page; use the component's `size` input (`size="lg"` for primary actions). New or newly generated Spartan components must use these variables instead of fixed heights.
- Touch first: keep targets comfortable (nav rail is 3.5rem collapsed with 40px rows).
- Colors and fonts come from `@micropos/theme` tokens (Tailwind classes such as `bg-primary`, `text-muted-foreground`); don't hard-code values.

## Local storage

- Use `StorageService` (`src/app/core/storage/`), never `localStorage` directly. Keys are namespaced `micropos.*`, values are JSON, reads fall back safely.
- Changing the shape, name or meaning of a stored value requires a new entry in `storage.migrations.ts` (append-only, next version number, idempotent). Never edit a shipped migration.
- Only per-device preferences belong here (theme, nav pin). Business data goes in SQLite via the main process.
- Keep the app `name` and the `file://` origin stable: both determine where storage lives.

## Barcode scanner

- USB keyboard-wedge scans are detected in the renderer (`src/app/core/scanner/`), not in Electron. `BurstDetector` is the pure timing logic (35ms gap, printable ASCII so 2D payloads work); `ScannerService` owns the single global listener and starts at the root.
- Take control with a claim: `claimScanner(handler)` in a component or dialog (released on destroy), or the `appScannerClaim` directive with `(scan)`. The newest claim gets scans; releasing it returns control to the previous one. A handler can return `false` to pass a scan down.
- Scans never leak into the UI: the first characters of a burst pass through (they look like typing), then once 3 fast keys (2 outside text fields) confirm a scanner the field is rolled back and every remaining key, including Enter, is blocked. That covers inputs, Space on a focused button or checkbox, and select type-ahead.
- To let a text field receive scans (e.g. a barcode lookup), put `appScanInput` on it (`(scan)` emits the code). While it is focused, a scan types into it like normal input, Enter included, and claims do not get that scan. Fields without it never keep scanned text.
- `KioskFocusService` stops mouse/touch presses on buttons from taking focus (clicks still work), so focus stays on the field a scan should go to. Add `data-allow-focus` to anything that must take focus.

## Database (SQLite + Drizzle)

- Main process only (`electron/db/`); the renderer reaches it over IPC. Schema is one file per table in `electron/db/schema/` (exported from `schema/index.ts`). Conventions: UUIDv7 text ids (`uuid7()`), money in integer cents, timestamps as epoch milliseconds, soft delete via `deleted_at` on catalog/people tables, orders are never deleted (void or refund instead), a partial unique index for any unique field on a soft-deletable table, and an index on every foreign key.
- Change workflow: edit the schema, run `pnpm db:generate` (writes a new SQL file in `electron/db/migrations/`; commit it, never hand-edit a shipped migration). Pending migrations are applied automatically when the app opens the database; packaged builds ship them via Forge `extraResource`.
- Commands (work from the repo root or `apps/desktop`; modeled on Laravel): `pnpm db:migrate` applies pending migrations; `pnpm db:migrate --fresh` drops every table, migrates from scratch and creates one admin account; `pnpm db:migrate --fresh --seed` also runs the factories; `pnpm db:seed` runs the factories only (refuses a database that already has a catalog); `--database=<file>` targets another file. The default file is `apps/desktop/local-data/micropos-dev.db`, which is also what the unpackaged dev app opens (packaged builds use the per-user data folder). Close the dev app before `--fresh`, then restart it.
- The bootstrap admin (`seeders/admin.seeder.ts`) is employee number `1001`, PIN from `MICROPOS_ADMIN_PIN` or the dev default `1234`. Dev tooling only: the CLI is not shipped in packaged builds.
- PINs are stored only as scrypt hashes (`electron/auth/pin.ts`).

### Factories and dummy data

- `electron/db/factories/` builds consistent dummy data (faker): employees, catalog, sales with lines and payments, voids, refunds, login sessions, audit entries, settings. Dev-only: not shipped in packaged builds and never imported by production code paths.
- **When the schema changes, check the factories.** New or renamed columns, new tables, changed constraints or enums (employee roles, order statuses, payment methods) usually need a matching change in the builders (`*.factory.ts`) and in `seed.ts` (insert order, FK order, totals that satisfy CHECK constraints). Update them in the same change.
- Verify with `pnpm test:db` (runs migrations on a temp database, seeds it, and checks constraints, totals, payments and foreign keys). Add a test for any new rule.
- Seeding is done through the commands above (`--seed`). Factories reuse the existing admin instead of creating another. Dummy sign-ins: `1001` (admin), `1002` (manager), `1003`+ (cashiers); dummy PIN `1234`.

## IPC bridge (renderer to database)

- The renderer never touches SQLite. It calls `window.micropos` (typed as `DesktopApi` in `@micropos/core`), exposed by the sandboxed preload (`electron/preload.ts`), answered by `ipcMain.handle` handlers in `electron/ipc/`. In Angular, inject `DESKTOP_API` (`core/api/desktop-api.ts`) or a service built on it, such as `CatalogService`; tests provide a fake `DESKTOP_API`.
- Adding a call: (1) add the DTO and method to `packages/core` (`catalog.ts`, `desktop-api.ts`) and rebuild core; (2) write the query as a plain function in `electron/db/queries/` and test it in `db.spec.ts`; (3) add the channel to `electron/ipc/channels.ts`; (4) register the handler in `electron/ipc/index.ts`; (5) expose it in `electron/preload.ts`; (6) use it from a service. Handlers stay thin: validate input, call the query, return plain data.
- Contract version: `DESKTOP_API_VERSION` (`@micropos/core`) and `API_VERSION` (`electron/ipc/channels.ts`) must be equal (a test enforces it). Bump both when a call or payload changes in a way an older main process cannot handle. At startup the page asks the main process for its version (`DesktopApiGuard`); on a mismatch, or an old main that does not answer, a persistent banner says to restart the app. In development the page hot-reloads but the main process does not, so **restart `pnpm dev` after any change under `electron/`** or to `packages/core`.
- DTOs in `@micropos/core` are types only (the CommonJS main process imports them with `import type`).
- For the dev app, run `pnpm db:migrate --fresh --seed` first so there is data to read.

## Checkout order draft

- The order in progress saves itself: every change to the lines is written (debounced 300 ms, flushed when the page closes) through `window.micropos.checkout.*` to the `settings` table under the key `checkout.draft` (`electron/db/queries/draft.ts`, `CheckoutDraftService` in Angular). It is restored when Checkout opens, including after an app restart. The main process validates whatever the renderer sends before storing it.
- In the ERD (`docs/erd.mmd`) the draft appears as the `checkout.draft` row of `settings`, with a dashed link to `products` (its lines hold product ids as JSON, with no foreign key). If drafts move to real `open` orders, update the ERD in the same change.
- It is one draft per register for now. Once employees sign in, move it to an `open` order (with its lines) per employee.
- **Clear vs Void:** *Clear* empties a cart that was never recorded and deletes the draft (confirmation dialog, no trace kept). *Void* is for a sale that was already recorded: it keeps the order with status `voided` and writes an audit entry so the books still add up. The checkout button is Clear; build Void when completed orders exist.

## Banner (short status messages)

- Use `BannerService` (`src/app/core/banner/`) for brief feedback instead of inline text: `banner.success('Bananas added')`, `banner.warning(msg, { duration: 'long' })`, `banner.error(...)`, `banner.info(...)`, or `banner.show(msg, { severity, duration, key })`. One thin strip at the top of the window (`BannerHost`, placed once in the root); click it to dismiss.
- Default duration is 1.5 s; presets `short` 0.8 s, `default` 1.5 s, `long` 4 s, `persistent` (stays until clicked or `dismiss()`), or any number of milliseconds. Default severity is `info`.
- Messages queue and show one at a time (at most 5 waiting; the oldest waiting ones are dropped). Pass a `key` for anything that can repeat quickly: the same key updates the banner on screen and restarts its timer instead of queueing again.
- The banner and the "window too small" overlay are popovers in the browser top layer so they sit above dialogs; both use `keepOnTop` (`core/viewport/top-layer.ts`) with a `data-top-layer-priority` (overlay 2, banner 1). Any new always-on-top element needs a priority too, or the elements will keep re-raising each other.
- Severity colors (`success`, `warning`, `destructive`, `primary`) come from `@micropos/theme` tokens.

## On-screen keyboard

- Settings > "On-screen keyboard" (off by default, per device) turns it on; "Numpad beside keyboard" adds a numpad to the right of the QWERTY keyboard. Both live in `AppSettings` (a new setting needs a default and a `storage.migrations.ts` entry).
- It is attached at the lowest level: `OnScreenKeyboardService` (`core/keyboard/`, started in the root `App`) listens for focus on the whole document, so **no per-field code is needed**. Every `text`, `search`, `email`, `url`, `tel`, `password` input and every `textarea` gets the QWERTY keyboard (number row on top, one-shot Shift, Enter, Done). Every `type="number"` input, and any input with `inputmode="decimal"` or `"numeric"`, gets the numeric keypad (`core/keypad/`).
- Both float next to the focused field (below, else above, right or left, whichever fits; they are pushed back into view instead of clipping), as overlays in the top layer. Their keys never take focus from the field (kiosk focus rule) and edit it at the caret, firing `input`; Done blurs the field, which is what commits it. While open, the field's `inputmode` is set to `none` so an OS soft keyboard does not appear too.
- Number inputs are switched to `type="text"` while the keypad is up (a number field cannot show a half-typed "3.") and back afterwards; the keypad takes its limits from the field: `step` sets the decimals (none: whole numbers, `any`: 3), `max` sets the whole digits. `change` fires on close if the value changed. There is no minus key yet.
- Opt a field or container out with `data-no-keyboard`. To set digit limits explicitly on a text field use the `appOnScreenKeypad` directive (`[keypadWholeDigits]`, `[keypadDecimals]`); it marks the field `data-keypad` so the global service leaves it alone. Prefer the plain attributes (`type="number"`, `step`, `max`, `inputmode`) and let the service handle it.
- When adding a field, just use a normal input; check it in the app with the setting on.
