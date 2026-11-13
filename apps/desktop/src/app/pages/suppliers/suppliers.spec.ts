import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { DesktopApi, SupplierInput, SupplierRecord } from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { BannerService } from '../../core/banner';
import { SuppliersPage } from './suppliers';

// jsdom has no ResizeObserver (overlay code watches element sizes).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

@Component({ template: '' })
class Blank {}

const supplier = (id: string, name: string, over: Partial<SupplierRecord> = {}): SupplierRecord => ({
  id,
  name,
  phone: null,
  note: null,
  owed: 0,
  openOrders: 0,
  createdAt: 1,
  deletedAt: null,
  ...over,
});

/** A fake main process holding suppliers in memory, recording the calls it gets. */
function fakeApi(initial: SupplierRecord[]) {
  const rows = [...initial];
  const calls = { created: [] as SupplierInput[], updated: [] as [string, SupplierInput][], removed: [] as string[][] };
  const api = {
    suppliers: {
      list: (options?: { includeDeleted?: boolean }) => Promise.resolve(rows.filter((s) => (options?.includeDeleted ? !!s.deletedAt : !s.deletedAt))),
      create: (input: SupplierInput) => {
        calls.created.push(input);
        const s = supplier(`n${rows.length}`, input.name, { phone: input.phone, note: input.note });
        rows.push(s);
        return Promise.resolve({ ok: true as const, supplier: s });
      },
      update: (id: string, input: SupplierInput) => {
        calls.updated.push([id, input]);
        const s = rows.find((r) => r.id === id)!;
        Object.assign(s, input);
        return Promise.resolve({ ok: true as const, supplier: s });
      },
      remove: (ids: string[]) => {
        calls.removed.push(ids);
        const blocked = rows.filter((s) => ids.includes(s.id) && (s.owed !== 0 || s.openOrders !== 0)).map((s) => s.name);
        for (const s of rows) if (ids.includes(s.id) && s.owed === 0 && s.openOrders === 0) s.deletedAt = 5;
        return Promise.resolve({ removed: ids.length - blocked.length, blocked });
      },
      restore: (ids: string[]) => {
        for (const s of rows) if (ids.includes(s.id)) s.deletedAt = null;
        return Promise.resolve();
      },
    },
  } as unknown as DesktopApi;
  return { api, calls, rows };
}

const SAMPLE = () => [
  supplier('a', 'Metro Wholesale', { phone: '02 8123 4567', owed: 250_000, openOrders: 2 }),
  supplier('b', 'Bakery Supply'),
  supplier('c', 'Cold Chain', { owed: 10_000 }),
];

describe('SuppliersPage', () => {
  let fixture: ComponentFixture<SuppliersPage>;
  let el: HTMLElement;
  let fake: ReturnType<typeof fakeApi>;

  async function open(rows = SAMPLE()): Promise<void> {
    fake = fakeApi(rows);
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }]), { provide: DESKTOP_API, useValue: fake.api }] });
    await TestBed.inject(Router).navigateByUrl('/suppliers');
    fixture = TestBed.createComponent(SuppliersPage);
    await settle();
    el = fixture.nativeElement as HTMLElement;
  }
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await fixture.whenStable();
    }
  };
  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
  });

  const names = (): string[] => Array.from(el.querySelectorAll('[role="row"] [role="cell"]:nth-child(2)')).map((c) => c.textContent!.trim());
  const rowOf = (name: string): HTMLElement => Array.from(el.querySelectorAll<HTMLElement>('[role="row"]')).find((r) => r.textContent?.includes(name))!;
  const type = async (selector: string, text: string, root: ParentNode = el): Promise<void> => {
    const input = root.querySelector(selector) as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };
  const button = (root: ParentNode, label: string): HTMLButtonElement | undefined =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

  it('lists suppliers by name with the orders on the way and what is owed', async () => {
    await open();
    expect(names()).toEqual(['Bakery Supply', 'Cold Chain', 'Metro Wholesale']);
    const cells = (name: string): string[] => Array.from(rowOf(name).querySelectorAll('[role="cell"]')).map((c) => c.textContent!.replace(/\s+/g, ' ').trim());
    expect(cells('Metro Wholesale')).toEqual(['', 'Metro Wholesale', '02 8123 4567', '2', '₱2,500.00']);
    expect(cells('Bakery Supply').slice(3)).toEqual(['-', '-']);
  });

  it('filters by name and by whether anything is owed', async () => {
    await open();
    await type('input[aria-label="Filter name"]', 'cold');
    expect(names()).toEqual(['Cold Chain']);
    (el.querySelector('button[aria-label="Reset filters"]') as HTMLElement).click();
    const page = fixture.componentInstance as unknown as { balanceFilter: { set(v: string): void } };
    page.balanceFilter.set('owed');
    await fixture.whenStable();
    expect(names()).toEqual(['Cold Chain', 'Metro Wholesale']);
    page.balanceFilter.set('settled');
    await fixture.whenStable();
    expect(names()).toEqual(['Bakery Supply']);
  });

  it('adds a supplier from the form', async () => {
    await open();
    button(el, 'Add supplier')!.click();
    await settle();
    const form = document.querySelector('#supplier-form')!;
    button(form, 'Save')!.click(); // no name yet
    await settle();
    expect(form.textContent).toContain('Enter a name');
    await type('#sup-name', '  Dairy   Direct ', form);
    await type('#sup-phone', '0917 000 0000', form);
    button(form, 'Save')!.click();
    await settle();
    expect(fake.calls.created).toEqual([{ name: '  Dairy   Direct ', phone: '0917 000 0000', note: null }]);
    expect(TestBed.inject(BannerService).current()?.text).toBe('Supplier added');
    expect(names()).toContain('Dairy   Direct');
  });

  it('deletes a supplier after confirming, but not one that is owed money', async () => {
    await open();
    rowOf('Bakery Supply').click(); // opens the form
    await settle();
    const form = document.querySelector('#supplier-form')!;
    expect(form.textContent).toContain('Edit supplier');
    button(form, 'Delete')!.click();
    await settle();
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Delete' && b.closest('hlm-alert-dialog-content'))!.click();
    await settle();
    expect(fake.calls.removed).toEqual([['b']]);
    expect(names()).not.toContain('Bakery Supply');
  });

  it('a supplier that is owed money offers no delete', async () => {
    await open();
    const page = fixture.componentInstance as unknown as { swipeFor(s: SupplierRecord): unknown[] };
    expect(page.swipeFor(SAMPLE()[0]!)).toEqual([]);
    expect(page.swipeFor(SAMPLE()[1]!)).toHaveLength(1);
  });
});
