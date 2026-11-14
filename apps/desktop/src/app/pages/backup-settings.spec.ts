import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { BackupInfo, DesktopApi } from '@micropos/core';
import { DESKTOP_API } from '../core/api/desktop-api';
import { BannerService } from '../core/banner';
import { HlmAccordionImports } from '@spartan-ng/helm/accordion';
import { BackupSettings } from './backup-settings';
import { SettingsSearch } from './settings-section';

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

@Component({ imports: [HlmAccordionImports, BackupSettings], template: '<hlm-accordion><app-backup-settings /></hlm-accordion>' })
class Host {}

const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const info = (name: string, over: Partial<BackupInfo> = {}): BackupInfo => ({ name, kind: 'auto', size: 2_500_000, createdAt: new Date(2026, 10, 14, 9, 30).getTime(), ...over });

function setup(initial: BackupInfo[] = [info('micropos-auto-20261114-093000.db'), info('micropos-manual-20261113-101500.db', { kind: 'manual', size: 400 })]) {
  let backups = [...initial];
  const calls = { created: 0, removed: [] as string[], exported: 0, csv: 0, imported: 0, restored: [] as string[] };
  const api = {
    backup: {
      list: () => Promise.resolve({ backups, folder: '/data/backups' }),
      create: () => (calls.created++, (backups = [info('micropos-manual-20261114-100000.db', { kind: 'manual' }), ...backups]), Promise.resolve({ ok: true as const, backup: backups[0]! })),
      remove: (name: string) => (calls.removed.push(name), (backups = backups.filter((b) => b.name !== name)), Promise.resolve(true)),
      exportTo: () => (calls.exported++, Promise.resolve({ ok: true as const, savedTo: '/home/me/micropos.db' })),
      exportCsv: () => (calls.csv++, Promise.resolve({ ok: true as const, savedTo: '/home/me/micropos-csv-1' })),
      importFrom: () => (calls.imported++, Promise.resolve({ ok: false as const, error: 'This is not a MicroPOS database' })),
      restore: (name: string) => (calls.restored.push(name), Promise.resolve({ ok: true as const })),
      openFolder: () => Promise.resolve(true),
    },
  } as unknown as DesktopApi;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }, SettingsSearch] });
  return calls;
}
async function render() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  await wait();
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}
const text = (el: HTMLElement): string => el.textContent!.replace(/\s+/g, ' ');
const button = (el: ParentNode, label: string | RegExp): HTMLButtonElement | undefined =>
  [...el.querySelectorAll('button')].find((b) => (typeof label === 'string' ? b.textContent?.trim() === label : label.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))) as HTMLButtonElement | undefined;

describe('BackupSettings', () => {
  it('lists the backups with their kind and size', async () => {
    setup();
    const { el } = await render();
    // The section is a collapsed accordion item; its content is still in the page.
    const t = text(el);
    expect(t).toContain('Automatic · 2.4 MB');
    expect(t).toContain('Manual · 1 KB');
  });

  it('backs up now and refreshes the list', async () => {
    const calls = setup();
    const { fixture, el } = await render();
    button(el, 'Back up now')!.click();
    await fixture.whenStable();
    await wait();
    expect(calls.created).toBe(1);
    expect(el.querySelectorAll('[data-backup-list] > div')).toHaveLength(3);
    expect(TestBed.inject(BannerService).current()?.text).toBe('Backup made');
  });

  it('deletes one backup', async () => {
    const calls = setup();
    const { fixture, el } = await render();
    button(el, /Delete the backup of micropos-manual/)!.click();
    await fixture.whenStable();
    await wait();
    expect(calls.removed).toEqual(['micropos-manual-20261113-101500.db']);
    expect(el.querySelectorAll('[data-backup-list] > div')).toHaveLength(1);
  });

  it('exports and says where the file went', async () => {
    const calls = setup();
    const { fixture, el } = await render();
    button(el, 'Export database')!.click();
    await fixture.whenStable();
    await wait();
    expect(calls.exported).toBe(1);
    expect(TestBed.inject(BannerService).current()?.text).toBe('Saved to /home/me/micropos.db');
  });

  it('exports CSV files and says which folder they went to', async () => {
    const calls = setup();
    const { fixture, el } = await render();
    button(el, 'Export as CSV')!.click();
    await fixture.whenStable();
    await wait();
    expect(calls.csv).toBe(1);
    expect(TestBed.inject(BannerService).current()?.text).toBe('Saved to /home/me/micropos-csv-1');
  });

  it('asks before replacing the data, and restores only after "Restore"', async () => {
    const calls = setup();
    const { fixture, el } = await render();
    button(el, /Restore the backup of micropos-auto/)!.click();
    await fixture.whenStable();
    await wait();
    expect(calls.restored).toEqual([]);
    expect(text(document.body)).toContain('All sales, stock, customers, users and settings here are replaced by the backup');
    [...document.body.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Restore').at(-1)!.click(); // the dialog's, after the rows'
    await fixture.whenStable();
    await wait();
    expect(calls.restored).toEqual(['micropos-auto-20261114-093000.db']);
    expect(TestBed.inject(BannerService).current()?.text).toBe('Data replaced: restarting…');
  });

  it('asks before importing a file, and shows why a bad file was refused', async () => {
    const calls = setup();
    const { fixture, el } = await render();
    button(el, 'Import database')!.click();
    await fixture.whenStable();
    await wait();
    expect(calls.imported).toBe(0);
    button(document.body, 'Choose a file')!.click();
    await fixture.whenStable();
    await wait();
    expect(calls.imported).toBe(1);
    expect(TestBed.inject(BannerService).current()?.text).toBe('This is not a MicroPOS database');
  });
});
