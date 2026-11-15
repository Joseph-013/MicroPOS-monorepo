# @micropos/mobile

Expo (managed workflow) + React Native, TypeScript. Uses `@micropos/core` for all business logic.

## Commands
- `pnpm dev:mobile` from the root builds core and starts Expo; or `pnpm --filter @micropos/mobile start` (Expo dev server; `android` / `ios` / `web` variants too)
- `pnpm --filter @micropos/mobile typecheck`
- Build core first (`pnpm --filter @micropos/core build`); Metro consumes its `dist/`.

## Notes
- `metro.config.js` watches the workspace root so the hoisted `node_modules` and `@micropos/core` resolve.
- No better-sqlite3 here; local storage must go behind a core storage interface (e.g. expo-sqlite).
- Bundle IDs are `com.micropos.mobile` (placeholder until release setup).
- `App.tsx` is a placeholder screen; no navigation, state or storage yet.

## Structure
- `src/theme.tsx`: colors from `@micropos/theme` tokens (follows system light/dark); `CONTROL` sizes match the desktop (44/36/56).
- `src/components/ui.tsx`: themed components (Button, Badge, Card, Field/Input, Checkbox, Toggle, RadioGroup, Select, Tabs, Dialog, AlertDialog, Table, ContextMenu). Square corners, no rounding (radio is the only circle). Dialogs, selects and menus are `Modal` sheets.
- `src/layout/`: `AppShell` is responsive at 768 px like the desktop's `md`: phone = 48px top bar (logo left, burger right) + right-hand drawer; tablet = left rail (icons, toggle to expand). Orientation is unlocked so tablets can rotate. `nav.ts` mirrors the desktop nav; there is no router yet (the shell holds the route id).
- `src/screens/ComponentsScreen.tsx`: port of the desktop Components page (dev-only entry, `__DEV__`); one column on phones, two on tablets. The desktop's barcode scanner section is not ported (hardware scanner, no equivalent yet).
- `src/banner.tsx`: banner provider (timed and persistent), like the desktop's BannerService.
- Nav entries have no permissions yet: add them with `@micropos/core` auth when the mobile app gets sign-in.
