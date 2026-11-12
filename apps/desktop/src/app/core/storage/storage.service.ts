import { inject, Service } from '@angular/core';
import { RawStorage, STORAGE_MIGRATIONS } from './storage.migrations';

/** Every key is namespaced so the app never touches (or loses track of) foreign keys. */
const PREFIX = 'micropos.';
const VERSION_KEY = 'schemaVersion';

/**
 * Typed, versioned wrapper over localStorage.
 *
 * - Values are JSON; reads never throw and fall back to the supplied default.
 * - On startup, pending migrations run in order so data written by older builds is
 *   upgraded in place instead of being orphaned. A failed step stops the run and the
 *   version is not advanced, so it is retried next launch.
 * - If storage is unavailable (blocked or private), an in-memory map is used.
 */
@Service()
export class StorageService {
  private readonly migrations = [...inject(STORAGE_MIGRATIONS)].sort((a, b) => a.version - b.version);
  private readonly backend = this.openBackend();
  private readonly memory = new Map<string, string>();

  /** Schema version of the data after migrations ran. */
  readonly version: number;

  constructor() {
    this.version = this.runMigrations();
  }

  get<T>(key: string, fallback: T, isValid?: (value: unknown) => value is T): T {
    const raw = this.rawGet(key);
    if (raw === null) return fallback;
    try {
      const value: unknown = JSON.parse(raw);
      if (isValid && !isValid(value)) return fallback;
      return value as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): void {
    this.rawSet(key, JSON.stringify(value));
  }

  remove(key: string): void {
    this.rawRemove(key);
  }

  private runMigrations(): number {
    const latest = this.migrations.at(-1)?.version ?? 0;
    const storedRaw = this.rawGet(VERSION_KEY);
    const stored = storedRaw === null ? 0 : Number(storedRaw);
    if (!Number.isInteger(stored) || stored < 0) {
      console.error(`Ignoring invalid storage version "${storedRaw}".`);
      return 0;
    }
    if (stored > latest) {
      // Data from a newer build: leave it untouched rather than downgrade it.
      console.warn(`Storage version ${stored} is newer than this app (${latest}).`);
      return stored;
    }

    const raw: RawStorage = {
      get: (k) => this.rawGet(k),
      set: (k, v) => this.rawSet(k, v),
      remove: (k) => this.rawRemove(k),
      keys: () => this.keys(),
    };

    let current = stored;
    for (const step of this.migrations.filter((m) => m.version > stored)) {
      try {
        step.migrate(raw);
      } catch (error) {
        console.error(`Storage migration to v${step.version} failed; will retry next launch.`, error);
        return current;
      }
      current = step.version;
      this.rawSet(VERSION_KEY, String(current));
    }
    return current;
  }

  private keys(): string[] {
    const all = this.backend
      ? Array.from({ length: this.backend.length }, (_, i) => this.backend!.key(i) ?? '')
      : [...this.memory.keys()].map((k) => PREFIX + k);
    return all.filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
  }

  private rawGet(key: string): string | null {
    try {
      return this.backend ? this.backend.getItem(PREFIX + key) : (this.memory.get(key) ?? null);
    } catch {
      return null;
    }
  }

  private rawSet(key: string, value: string): void {
    try {
      if (this.backend) this.backend.setItem(PREFIX + key, value);
      else this.memory.set(key, value);
    } catch {
      this.memory.set(key, value);
    }
  }

  private rawRemove(key: string): void {
    try {
      if (this.backend) this.backend.removeItem(PREFIX + key);
      else this.memory.delete(key);
    } catch {
      this.memory.delete(key);
    }
  }

  private openBackend(): Storage | null {
    try {
      const probe = `${PREFIX}__probe`;
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch {
      return null;
    }
  }
}
