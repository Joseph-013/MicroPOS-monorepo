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
- Destructive actions (Delete, Clear, Remove) use the `destructive` variant on the button, the menu item (`variant="destructive"`) and the confirming alert-dialog action. Restore and other safe confirmations stay default.
- Space is at a premium: keep page padding tight (main content uses `p-3`) and put titles close to the edges.
- Styles are plain CSS (Tailwind v4 via PostCSS), not Sass; global styles live in `src/styles.css`.
- Kiosk behavior: text selection is off app-wide (`html { user-select: none }` in `styles.css`). Inputs and textareas stay selectable; opt other text in with Tailwind `select-text` or `select-all` (order numbers, receipt text, error messages).
- Minimum window is 1024 × 600 (`MIN_WINDOW` in `core/viewport/too-small-overlay.ts`); below it a full-window warning covers the app. Design layouts for that minimum.
- Touch sizing lives at the root: `--control-height` (44px), `--control-height-sm` (36px), `--control-height-lg` (56px) and `--popup-offset` in `src/styles.css`. Buttons, inputs, selects, tabs, and menu/list rows read them, so one edit resizes the app. Do not set `h-*`/`size-*` on a control in a page; use the component's `size` input (`size="lg"` for primary actions). New or newly generated Spartan components must use these variables instead of fixed heights.
- Touch first: keep targets comfortable (nav rail is 3.5rem collapsed with 40px rows).
- Colors and fonts come from `@micropos/theme` tokens (Tailwind classes such as `bg-primary`, `text-muted-foreground`); don't hard-code values.

## Table design

The Products table (`pages/products/`) is the reference; build every data table the same way.

**Layout**
- A CSS grid with table roles (`role="table"`, `rowgroup`, `row`, `columnheader`, `cell`), not a `<table>`, so each row can sit inside `app-swipe-actions`. One column template (`COLUMNS_TEMPLATE`) is shared by the title row, the filter row and every body row. The table has a `min-w-*`; the area around it scrolls both ways and has no side padding (swipe actions stick to its visible edge).
- The header is sticky and has two rows. **Row 1** holds the column titles: each is a button that sorts by that column (click once ascending, again descending) with a direction arrow (`lucideChevronsUpDown` when idle) and `aria-sort`. **Row 2** holds the filter for that column, directly above the data it filters. Example: the Name column is "Name ^" over a text input; the Categories column is "Categories ^" over a select. There is no separate search or filter bar above a table, and the header with its filters stays visible when no rows match.
- Filter controls fit the column: text input for names and codes, combobox or select for categories and status, a from/to date range (native date inputs) for dates, a range for numbers. Text and date filters use `app-filter-input` (`core/ui/filter-input.ts`: an input group with a circled-x clear button that shows while there is a value); comboboxes use `showClear` (hidden while on "All"). Filters are compact (the filter row sets `--control-height` to the small size) and have placeholders. Columns with nothing to filter leave their filter cell empty. Filters on different columns combine (AND).
- **Leftmost column is selection**: a checkbox per row, and the title-row checkbox selects every visible row (shows a dash while only some are ticked). The filter-row cell under it holds a **Reset filters** icon button (disabled when no filter is set). Selection only counts rows that are on screen.
- Default sort is by created date, newest first; empty values (no SKU, no cost) always sort last. Money columns are right-aligned. Status columns use a badge: `success` (green) for active, `destructive` (red) for inactive, `outline` for deleted.
- Small text for long codes (SKU `text-xs`), muted color for secondary columns, truncate long values.

**Row actions** (every route offers the same actions)
- Bulk buttons appear in the page header when rows are ticked ("N selected", then the actions that apply, then Clear).
- Right-click (or long-press) context menu on the row; if the row is part of a multi-row selection the action applies to the whole selection (single or bulk). Delete is destructive-styled; menu items that would change nothing are not offered. Status changes read "Set" followed by the badge the row will get (`Set [Active]`, `Set [Inactive]`).
- Swipe left on a row (touch): icon-only action (the shared swipe component; red with a white icon for delete, green for restore). Mouse and keyboard users have the menu and buttons.
- Delete and restore always show a confirmation dialog, whichever route started them. Status changes and other easily undone edits apply at once with a banner.
- Deleted rows are reached through a "Deleted only" switch in the page header (swaps the list; the normal list never mixes them); they are dimmed, read-only, and can be restored.

**Motion**: rows fade in and out (`animate.enter` / `animate.leave` with `row-enter` / `row-leave`, 0.1 s), and a row whose data changed flashes the accent color briefly (`row-flash`); all in `styles.css`. Rows do not animate on the first load.

## Local storage

- Use `StorageService` (`src/app/core/storage/`), never `localStorage` directly. Keys are namespaced `micropos.*`, values are JSON, reads fall back safely.
- Changing the shape, name or meaning of a stored value requires a new entry in `storage.migrations.ts` (append-only, next version number, idempotent). Never edit a shipped migration.
- Only per-device preferences belong here (theme, nav pin). Business data goes in SQLite via the main process.
- Keep the app `name` and the `file://` origin stable: both determine where storage lives.

## Barcode scanner

- USB keyboard-wedge scans are detected in the **Electron main process** (`electron/scanner/`), in front of the page, so a stray scan can never reach the UI. `attachScanner(win)` (called in `main.ts`) hooks the window's `before-input-event`. `ScanGate` holds every printable key back for one speed threshold (35 ms): if the burst turns out to be a scan (`BurstDetector`: min 3 chars with Enter, 6 without; printable ASCII so 2D payloads work) the held keys are discarded, the closing Enter is swallowed and the code is sent to the page as `scanner:scan`; if it was a person typing, the held keys are replayed to the page in order (`sendInputEvent`), so typing is delayed by at most 35 ms. Shortcuts (Ctrl/Alt/Meta), Tab, arrows etc. pass straight through. Shift/CapsLock never disturb a burst.
- Because the scan's keys are never delivered, nothing can leak: no text in fields, no Space pressing a focused button or checkbox, no Enter reopening a dialog trigger, whatever has focus. The renderer has no keyboard listener for scans any more.
- The renderer (`src/app/core/scanner/`): `ScannerService` (started at the root) subscribes to `window.micropos.scanner.onScan` and only decides who gets the code. Without the Electron bridge (plain browser) no scans arrive. `scanner.enabled` is forwarded to the main process (`scanner.setEnabled`); off lets scanner keys through as ordinary typing.
- Take control with a claim: `claimScanner(handler)` in a component or dialog (released on destroy), or the `appScannerClaim` directive with `(scan)`. The newest claim gets scans; releasing it returns control to the previous one. A handler can return `false` to pass a scan down.
- To let a text field receive scans (e.g. a barcode lookup), put `appScanInput` on it (`(scan)` emits the code). While it is focused the scan sets its value to the code (firing `input`), and claims do not get that scan. Fields without it never receive scanned text.
- Tests: the gate and detector are pure and tested with a fake clock in `electron/scanner/*.spec.ts` (`pnpm test:db`). In page specs, stand in for the scanner with `TestBed.inject(ScannerService).receive(code)`. Note that CDP and `sendInputEvent` key events bypass `before-input-event`, so the main-process path can only be exercised with real keyboard input.
- Changing anything under `electron/scanner/` needs a restart of `pnpm dev`.
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
- Contract version: `DESKTOP_API_VERSION` (`@micropos/core`) and `API_VERSION` (`electron/ipc/channels.ts`) must be equal (a test enforces it). Bump both when a call or payload changes in a way an older main process cannot handle. At startup the page asks the main process for its version (`DesktopApiGuard`); on a mismatch, or an old main that does not answer, a persistent banner says to restart the app. In development the page hot-reloads but the main process does not, so **restart `pnpm dev` after any change under `electron/`** or to `packages/core` (the dev script clears the Angular dev-server cache on start, which otherwise keeps a stale pre-bundled copy of core and shows "out of date" even when both sides match).
- DTOs in `@micropos/core` are types only (the CommonJS main process imports them with `import type`).
- For the dev app, run `pnpm db:migrate --fresh --seed` first so there is data to read.

## Products page

- `pages/products/` lists every live product (active or not) from `ProductsService` (`window.micropos.products.*`, queries in `electron/db/queries/products.ts`); Checkout still reads active products only through `CatalogService`. Rows open an add/edit dialog (`ProductForm`, opened with `HlmDialogService`); Delete asks first and soft-deletes.
- Validation lives in the main process (`sanitizeProductInput`, duplicate SKU/barcode check); a rule violation returns `{ ok: false, field, error }` and the form shows it under that field. Prices are typed in pesos and stored as cents (`core/money-input.ts`).
- **Sold by / weighed products:** `products.unit` is `each` or a weight unit (`kg`, `g`, `lb`, `oz`); the price and cost are per that unit and the checkout quantity is the weight (decimal, stored as thousandths). Adding a weighed product at checkout opens its weight field at once; adding it again edits that weight instead of adding a unit. A draft line carries its `unit`.
- **One code field:** barcode and PLU are one column, `barcode` (shown as "Barcode / PLU"): packaged goods have an EAN, loose goods a short PLU, rarely both. SKU stays separate (your own stock code). A weighed product must have a code (form, `sanitizeProductInput` and a CHECK all enforce it); counted ones need none. Seeded counted goods get an EAN, weighed ones a 4-digit PLU. In the Products table a PLU (4 or 5 digits, `isPlu` in core) is shown in italics and a barcode in regular type. Reading variable-weight barcodes (prefix `2` + item code + weight) is not built yet.
- **Delete and restore:** a leftmost select column (header checkbox selects every visible row) feeds bulk Delete / Restore buttons in the page header; a row can also be deleted or restored from its right-click menu or by swiping it left. All routes go through one confirmation dialog (`ask()` in `products.ts`), always shown. Acting on a row that is part of a multi-row selection applies to the whole selection. Restore skips a product whose SKU or barcode a live product has since taken and names it in a banner. The "Deleted only" switch swaps the list to just the deleted products (and the normal list hides them); deleted rows cannot be edited.
- The Products table is a CSS grid with table roles (`role="table"`, `row`, `cell`), not a `<table>`, because a row has to be wrapped in `app-swipe-actions` to be swipeable and `<tr>` cannot be wrapped. The title row, filter row and body rows share one column template (`COLUMNS_TEMPLATE`).
- **Scanner:** the page claims the scanner: a scan resets the filters and sets the Barcode / PLU filter to the code, with a warning banner when nothing matches. While the product form is open it claims the scanner instead and a scan fills its Barcode / PLU field (typed straight into it when that field is focused via `appScanInput`, and put there from any other field of the form, never into the name or SKU), so the table behind never changes and barcodes need no manual typing. The row's Enter handler still ignores a `defaultPrevented` Enter, a harmless guard now that the main process swallows a scan's keys.
- Gotcha: a dialog opened through `HlmDialogService` must pass its own `id`. Its auto id (`brn-dialog-N`) can equal the id of an `<hlm-alert-dialog>` or `<hlm-dialog>` inside it, which throws "Dialog with ID ... already exists" and the inner dialog silently never opens.

## Checkout order draft

- The order in progress saves itself: every change to the lines is written (debounced 300 ms, flushed when the page closes) through `window.micropos.checkout.*` to the `settings` table under the key `checkout.draft` (`electron/db/queries/draft.ts`, `CheckoutDraftService` in Angular). It is restored when Checkout opens, including after an app restart. The main process validates whatever the renderer sends before storing it.
- In the ERD (`docs/erd.mmd`) the draft appears as the `checkout.draft` row of `settings`, with a dashed link to `products` (its lines hold product ids as JSON, with no foreign key). If drafts move to real `open` orders, update the ERD in the same change.
- It is one draft per register for now. Once employees sign in, move it to an `open` order (with its lines) per employee.
- **Clear vs Void:** *Clear* empties a cart that was never recorded and deletes the draft (confirmation dialog, no trace kept). *Void* is for a sale that was already recorded: it keeps the order with status `voided` and writes an audit entry so the books still add up. The checkout button is Clear; build Void when completed orders exist.

## Banner (short status messages)

- Use `BannerService` (`src/app/core/banner/`) for brief feedback instead of inline text: `banner.success('Bananas added')`, `banner.warning(msg, { duration: 'long' })`, `banner.error(...)`, `banner.info(...)`, or `banner.show(msg, { severity, duration, key })`. One thin strip at the top of the window (`BannerHost`, placed once in the root); click it to dismiss.
- Default duration is 1.5 s; presets `short` 0.8 s, `default` 1.5 s, `long` 4 s, `persistent` (stays until clicked or `dismiss()`), or any number of milliseconds. Default severity is `info`.
- **Persistent banners** (`duration: 'persistent'`, e.g. an impending update notice) are kept apart from the queue and stay until the system calls `banner.remove(key)` (or `dismiss()` / a click, unless `dismissible: false`). Timed banners show over them for their moment and the persistent one returns. While one exists, `reserveSpace()` is true and the app root sets `--banner-offset` (2.25rem): the root pads down by it, the nav rail starts below it, and any page that sizes itself to the viewport must use `calc(100svh - var(--banner-offset,0px) - ...)` so nothing hides behind the strip.
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
