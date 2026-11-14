import { TestBed } from '@angular/core/testing';
import type { DesktopApi } from '@micropos/core';
import { provideRouter } from '@angular/router';
import { DESKTOP_API } from './api/desktop-api';
import { AuthService } from './auth/auth.service';
import { fakeAuthApi, sessionUser } from './auth/testing';
import { NavRail } from './nav-rail';

describe('NavRail access', () => {
  async function render(permissions: Parameters<typeof sessionUser>[0], alerts = 0, extra: Record<string, unknown> = {}): Promise<string> {
    localStorage.clear();
    const api = { ...fakeAuthApi({ status: sessionUser(permissions) }).api, customers: { alertCount: () => Promise.resolve(alerts) }, ...extra } as unknown as DesktopApi;
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', children: [] }]), { provide: DESKTOP_API, useValue: api }],
    });
    await TestBed.inject(AuthService).whenReady();
    const fixture = TestBed.createComponent(NavRail);
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 20));
    await fixture.whenStable();
    return (fixture.nativeElement as HTMLElement).textContent!;
  }

  it('shows a cashier only what they may use, and drops groups with nothing left', async () => {
    const text = await render(['checkout.sell', 'customers.view']);
    expect(text).toContain('Checkout');
    expect(text).toContain('Customers');
    for (const hidden of ['Sales Orders', 'Items', 'Purchasing', 'Users']) expect(text).not.toContain(hidden);
    expect(text).toContain('Settings');
    expect(text).toContain('Sam');
  });

  it('shows a group with the entries that are allowed', async () => {
    const text = await render(['inventory.manage', 'users.manage']);
    expect(text).toContain('Items');
    expect(text).toContain('Inventory');
    expect(text).not.toContain('Products');
    expect(text).toContain('Users');
  });

  it('shows how many customers need attention on the Customers link, and nothing when none do', async () => {
    expect(await render(['customers.view'], 3)).toContain('3');
    TestBed.resetTestingModule();
    const text = await render(['customers.view'], 0);
    expect(text).not.toMatch(/\d/);
  });

  it('shows no count to someone who cannot see customers', async () => {
    expect(await render(['checkout.sell'], 3)).not.toContain('3');
  });

  it('counts stock and purchase concerns on their links, and the Items group shows the stock total', async () => {
    const text = await render(['inventory.manage', 'purchasing.manage'], 0, {
      inventory: { concerns: () => Promise.resolve([{}, {}, {}]) },
      purchases: { concerns: () => Promise.resolve([{}, {}]) },
    });
    const labelled = text.replace(/\s+/g, ' ');
    expect(labelled).toMatch(/Inventory\s*3/);
    expect(labelled).toMatch(/Purchases\s*2/);
    // The groups, collapsed to their icon, carry the total of what is inside them.
    expect((labelled.match(/3/g) ?? []).length).toBe(2); // the group's number and Inventory's own
  });

  it('shows no stock or purchase count without those permissions', async () => {
    const text = await render(['checkout.sell'], 0, {
      inventory: { concerns: () => Promise.resolve([{}, {}, {}]) },
      purchases: { concerns: () => Promise.resolve([{}, {}]) },
    });
    expect(text).not.toMatch(/\d/);
  });
});
