# @micropos/mobile

Expo (managed workflow) + React Native, TypeScript. Uses `@micropos/core` for all business logic.

## Commands
- `pnpm dev:mobile` from the root builds core and theme and starts Metro; `pnpm --filter @micropos/mobile android` builds and installs the development build (native module, Android SDK needed). `ios`/`web` are not supported by the native module.
- `pnpm --filter @micropos/mobile typecheck`
- Build core first (`pnpm --filter @micropos/core build`); Metro consumes its `dist/`.

## Connecting to the till (LAN)
- The phone talks to the desktop's LAN server (see "Devices" in `apps/desktop/CLAUDE.md`): `src/lan/client.ts` (`TillClient`: `/lan/rpc`, the shared WebSocket `Changes`, `createRemoteApi` giving the same `DesktopApi` as the desktop window), `pair.ts` (code to token), `parse.ts` (the QR address `https://<ip>:<port>/?pair=<code>&fp=<pin>`), `store.ts` (the pairing, token included, in the Android keystore via expo-secure-store), `TillProvider.tsx` (state, `useTill()`). Pure parts have vitest specs (`pnpm --filter @micropos/mobile test`).
- **The till's certificate is self-signed**, so a native pin is needed: `modules/micropos-tls` (Expo local module, Kotlin) sets a custom OkHttp trust manager through React Native's `setCustomClientBuilder` for fetch and WebSocket. `setPin(hex)` trusts a server whose public key hashes to the pin (any address); anything else must pass Android's normal checks. The pin comes from the QR and is set again at every start (`TillProvider`) before the first request. **Needs a development build (`pnpm --filter @micropos/mobile android` = `expo run:android`, needs the Android SDK) and does not work in Expo Go** (`pinningAvailable` is false there and the pairing screen says so). **The Kotlin is unverified: it could not be compiled where it was written.** First run on a device: pair, then check that Settings shows Connected.
- Not built: signing in with a PIN, finding the till again when its IP changes (pair again), tablets/phones discovery.

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
