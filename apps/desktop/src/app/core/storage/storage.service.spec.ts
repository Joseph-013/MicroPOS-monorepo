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
