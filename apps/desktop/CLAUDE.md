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

- Renderer: Angular, built to `dist/renderer` (`pnpm build:renderer`). `<base href="./">` so it loads over `file://`.
- Main/preload: `electron/*.ts`, compiled with `tsc -p tsconfig.electron.json` to `dist/electron` (CommonJS). `package.json` `main` points at `dist/electron/main.js`.
- Commands: `pnpm --filter @micropos/desktop start | build | package | make | typecheck | test`.
- Renderer has no Node access (contextIsolation, sandbox). Expose capabilities via IPC in `electron/preload.ts`.
- Angular and `@micropos/core` are bundled into the renderer, so they live in `devDependencies`. `forge.config.js` sets `prune: false` and excludes `node_modules` because Forge's dependency walker can't resolve hoisted workspace deps. When adding native runtime deps (better-sqlite3), they must be shipped and unpacked from the asar; revisit this config then.
- Not containerized (see `.dockerignore`).

## UI conventions (MicroPOS)

- Copy: titles and labels are short, professional, sentence case ("Checkout", "Sales Orders"). No descriptions, subtitles or helper text unless critically necessary, e.g. confirmation dialogs.
- Shape: square and boxy everywhere. No `rounded-*` classes; the theme radius is 0.
- Space is at a premium: keep page padding tight (main content uses `p-3`) and put titles close to the edges.
- Touch first: keep targets comfortable (nav rail is 3.5rem collapsed with 40px rows).
- Colors and fonts come from `@micropos/theme` tokens (Tailwind classes such as `bg-primary`, `text-muted-foreground`); don't hard-code values.

## Local storage

- Use `StorageService` (`src/app/core/storage/`), never `localStorage` directly. Keys are namespaced `micropos.*`, values are JSON, reads fall back safely.
- Changing the shape, name or meaning of a stored value requires a new entry in `storage.migrations.ts` (append-only, next version number, idempotent). Never edit a shipped migration.
- Only per-device preferences belong here (theme, nav pin). Business data goes in SQLite via the main process.
- Keep the app `name` and the `file://` origin stable: both determine where storage lives.
