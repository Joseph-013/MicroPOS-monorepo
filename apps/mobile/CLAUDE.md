# @micropos/mobile

Expo (managed workflow) + React Native, TypeScript. Uses `@micropos/core` for all business logic.

## Commands
- `pnpm --filter @micropos/mobile start` (Expo dev server; `android` / `ios` / `web` variants too)
- `pnpm --filter @micropos/mobile typecheck`
- Build core first (`pnpm --filter @micropos/core build`); Metro consumes its `dist/`.

## Notes
- `metro.config.js` watches the workspace root so the hoisted `node_modules` and `@micropos/core` resolve.
- No better-sqlite3 here; local storage must go behind a core storage interface (e.g. expo-sqlite).
- Bundle IDs are `com.micropos.mobile` (placeholder until release setup).
- `App.tsx` is a placeholder screen; no navigation, state or storage yet.
