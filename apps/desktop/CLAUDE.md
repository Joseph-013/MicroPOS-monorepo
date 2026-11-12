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
- Renderer has no Node access (contextIsolation, sandbox). Expose capabilities via IPC in `electron/preload.ts`.
- Angular and `@micropos/core` are bundled into the renderer, so they live in `devDependencies`. `forge.config.js` sets `prune: false` and excludes `node_modules` because Forge's dependency walker can't resolve hoisted workspace deps. When adding native runtime deps (better-sqlite3), they must be shipped and unpacked from the asar; revisit this config then.
- Not containerized (see `.dockerignore`).

## UI conventions (MicroPOS)

- Copy: titles and labels are short, professional, sentence case ("Checkout", "Sales Orders"). No descriptions, subtitles or helper text unless critically necessary, e.g. confirmation dialogs.
- Shape: square and boxy everywhere. No `rounded-*` classes; the theme radius is 0. Only radio buttons stay circular (as in the design). Dialogs are square with the `blueprint` corner marks; only confirmation (alert) dialogs carry a description.
- Space is at a premium: keep page padding tight (main content uses `p-3`) and put titles close to the edges.
- Styles are plain CSS (Tailwind v4 via PostCSS), not Sass; global styles live in `src/styles.css`.
- Kiosk behavior: text selection is off app-wide (`html { user-select: none }` in `styles.css`). Inputs and textareas stay selectable; opt other text in with Tailwind `select-text` or `select-all` (order numbers, receipt text, error messages).
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
