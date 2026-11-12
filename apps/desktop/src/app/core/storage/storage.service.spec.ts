import { TestBed } from '@angular/core/testing';
import { STORAGE_MIGRATIONS, StorageMigration, STORAGE_MIGRATIONS_LIST } from './storage.migrations';
import { StorageService } from './storage.service';

function create(migrations?: readonly StorageMigration[]): StorageService {
  TestBed.resetTestingModule();
  if (migrations) TestBed.configureTestingModule({ providers: [{ provide: STORAGE_MIGRATIONS, useValue: migrations }] });
  return TestBed.inject(StorageService);
}

describe('StorageService', () => {
  beforeEach(() => localStorage.clear());

  it('stores and reads typed JSON values with fallbacks', () => {
    const storage = create();
    expect(storage.get('missing', 42)).toBe(42);
    storage.set('n', 7);
    expect(storage.get('n', 0)).toBe(7);
    localStorage.setItem('micropos.bad', '{oops');
    expect(storage.get('bad', 'fallback')).toBe('fallback');
    const isString = (v: unknown): v is string => typeof v === 'string';
    expect(storage.get('n', 'x', isString)).toBe('x');
  });

  it('stamps the latest version on a fresh install', () => {
    const storage = create();
    expect(storage.version).toBe(STORAGE_MIGRATIONS_LIST.at(-1)!.version);
    expect(localStorage.getItem('micropos.schemaVersion')).toBe(String(storage.version));
  });

  it('upgrades the legacy bare-string theme instead of orphaning it', () => {
    localStorage.setItem('micropos.theme', 'dark');
    localStorage.setItem('micropos.navPinned', 'true');
    const storage = create();
    expect(storage.get('theme', 'system')).toBe('dark');
    expect(storage.get('navPinned', false)).toBe(true);
  });

  it('gives an install that predates the setting an explicit on-screen keyboard default (off)', () => {
    localStorage.setItem('micropos.schemaVersion', '1');
    localStorage.setItem('micropos.theme', '"dark"');
    const storage = create();
    expect(storage.get('onScreenKeyboard', true)).toBe(false); // written by the migration, not the fallback
    expect(localStorage.getItem('micropos.onScreenKeyboard')).toBe('false');
    expect(storage.get('theme', 'system')).toBe('dark'); // other values untouched
    expect(storage.version).toBeGreaterThanOrEqual(2);
  });

  it('gives an install from before the numpad option an explicit default (off) without touching other settings', () => {
    localStorage.setItem('micropos.schemaVersion', '2');
    localStorage.setItem('micropos.onScreenKeyboard', 'true');
    const storage = create();
    expect(storage.get('showNumpad', true)).toBe(false);
    expect(storage.get('onScreenKeyboard', false)).toBe(true);
    expect(storage.version).toBeGreaterThanOrEqual(3);
  });

  it('does not overwrite a value the user already chose', () => {
    localStorage.setItem('micropos.schemaVersion', '1');
    localStorage.setItem('micropos.onScreenKeyboard', 'true');
    expect(create().get('onScreenKeyboard', false)).toBe(true);
  });

  it('runs only pending migrations, in version order', () => {
    localStorage.setItem('micropos.schemaVersion', '1');
    const calls: number[] = [];
    const storage = create([
      { version: 3, migrate: () => void calls.push(3) },
      { version: 1, migrate: () => void calls.push(1) },
      { version: 2, migrate: () => void calls.push(2) },
    ]);
    expect(calls).toEqual([2, 3]);
    expect(storage.version).toBe(3);
  });

  it('can move data between keys', () => {
    localStorage.setItem('micropos.old', '"v"');
    create([
      {
        version: 1,
        migrate: (s) => {
          s.set('new', s.get('old')!);
          s.remove('old');
        },
      },
    ]);
    expect(localStorage.getItem('micropos.new')).toBe('"v"');
    expect(localStorage.getItem('micropos.old')).toBeNull();
  });

  it('stops at a failing migration, keeps data, and retries next launch', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    localStorage.setItem('micropos.keep', '"data"');
    let fail = true;
    const migrations: StorageMigration[] = [
      { version: 1, migrate: () => undefined },
      {
        version: 2,
        migrate: () => {
          if (fail) throw new Error('boom');
        },
      },
      { version: 3, migrate: () => undefined },
    ];
    expect(create(migrations).version).toBe(1);
    expect(localStorage.getItem('micropos.schemaVersion')).toBe('1');
    expect(localStorage.getItem('micropos.keep')).toBe('"data"');

    fail = false;
    expect(create(migrations).version).toBe(3);
  });

  it('leaves data from a newer build untouched', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.setItem('micropos.schemaVersion', '99');
    const migrate = vi.fn();
    const storage = create([{ version: 1, migrate }]);
    expect(migrate).not.toHaveBeenCalled();
    expect(storage.version).toBe(99);
    expect(localStorage.getItem('micropos.schemaVersion')).toBe('99');
  });

  it('exposes only app-owned keys to migrations', () => {
    localStorage.setItem('micropos.a', '1');
    localStorage.setItem('other.b', '2');
    let seen: string[] = [];
    create([{ version: 1, migrate: (s) => void (seen = s.keys()) }]);
    expect(seen).toContain('a');
    expect(seen).not.toContain('other.b');
  });
});
