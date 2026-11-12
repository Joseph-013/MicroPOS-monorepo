import { InjectionToken } from '@angular/core';

/** Raw, unprefixed-key access handed to migrations. Values are the stored strings. */
export interface RawStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Every key owned by the app (without the app prefix). */
  keys(): string[];
}

/**
 * One step that upgrades stored data to `version`.
 *
 * Rules:
 * - Append only; never edit or reorder a shipped migration, and never reuse a version.
 * - Idempotent: localStorage has no transactions, so a step may re-run after a crash.
 * - Move or transform data; do not delete values you cannot interpret.
 */
export interface StorageMigration {
  version: number;
  migrate(store: RawStorage): void;
}

const THEME_VALUES = new Set(['light', 'dark', 'system']);

export const STORAGE_MIGRATIONS_LIST: readonly StorageMigration[] = [
  {
    // Early builds stored the theme as a bare string ("dark"); values are now JSON ("\"dark\"").
    version: 1,
    migrate(store) {
      const theme = store.get('theme');
      if (theme !== null && THEME_VALUES.has(theme)) store.set('theme', JSON.stringify(theme));
    },
  },
  {
    // The "on-screen keyboard" setting was introduced: every existing install gets an explicit default (off).
    version: 2,
    migrate(store) {
      if (store.get('onScreenKeyboard') === null) store.set('onScreenKeyboard', 'false');
    },
  },
  {
    // The QWERTY keyboard gained an optional numpad: existing installs get an explicit default (off).
    version: 3,
    migrate(store) {
      if (store.get('showNumpad') === null) store.set('showNumpad', 'false');
    },
  },
];

export const STORAGE_MIGRATIONS = new InjectionToken<readonly StorageMigration[]>(
  'STORAGE_MIGRATIONS',
  { providedIn: 'root', factory: () => STORAGE_MIGRATIONS_LIST },
);
