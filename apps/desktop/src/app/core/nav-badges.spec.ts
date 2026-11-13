import { TestBed } from '@angular/core/testing';
import type { DataDomain, DesktopApi } from '@micropos/core';
import { DESKTOP_API } from './api/desktop-api';
import { AuthService } from './auth/auth.service';
import { fakeAuthApi, sessionUser } from './auth/testing';
import { CustomersService } from './data/customers.service';
import { NavBadges } from './nav-badges';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('live data announcements', () => {
  let announce: (domains: DataDomain[]) => void;
  let stopped = 0;
  const calls = { customers: 0, stock: 0, purchases: 0, customerList: 0 };
  let stockCount = 1;
  let customerAlerts = 2;

  async function setup(permissions: Parameters<typeof sessionUser>[0]): Promise<void> {
    localStorage.clear();
    Object.assign(calls, { customers: 0, stock: 0, purchases: 0, customerList: 0 });
    stopped = 0;
    const api = {
      ...fakeAuthApi({ status: sessionUser(permissions) }).api,
      data: {
        onChanged: (listener: (domains: DataDomain[]) => void) => {
          announce = listener;
          return () => void stopped++;
        },
      },
      customers: { alertCount: () => (calls.customers++, Promise.resolve(customerAlerts)), list: () => (calls.customerList++, Promise.resolve([])) },
      inventory: { concerns: () => (calls.stock++, Promise.resolve(Array.from({ length: stockCount }, () => ({})))) },
      purchases: { concerns: () => (calls.purchases++, Promise.resolve([])) },
    } as unknown as DesktopApi;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
    await TestBed.inject(AuthService).whenReady();
  }

  it('refreshes the badges when the main process announces a change, once for several announcements together', async () => {
    await setup(['customers.view', 'inventory.manage']);
    const badges = TestBed.inject(NavBadges);
    await wait(20);
    expect(badges.counts()).toEqual({ customers: 2, inventory: 1 });
    const before = { ...calls };

    stockCount = 4;
    customerAlerts = 0;
    announce(['customers']);
    announce(['stock']);
    announce(['customers', 'stock']);
    await wait(250);
    expect(badges.counts()).toEqual({ inventory: 4 }); // no customers left: no number
    expect(calls.stock - before.stock).toBe(1);
    expect(calls.customers - before.customers).toBe(1);
  });

  it('only asks about what the person may see, and stops listening with the service', async () => {
    await setup(['checkout.sell']);
    const badges = TestBed.inject(NavBadges);
    await wait(20);
    expect(calls).toMatchObject({ customers: 0, stock: 0, purchases: 0 });
    expect(badges.counts()).toEqual({});
    TestBed.resetTestingModule();
    expect(stopped).toBeGreaterThan(0);
  });

  it('reloads a loaded list for its own part of the data only', async () => {
    await setup(['customers.view']);
    const customers = TestBed.inject(CustomersService);
    announce(['customers']);
    await wait(20);
    expect(calls.customerList).toBe(0); // nothing loaded yet: nothing to keep fresh
    await customers.load();
    expect(calls.customerList).toBe(1);
    announce(['stock', 'purchases']);
    await wait(20);
    expect(calls.customerList).toBe(1);
    announce(['customers']);
    await wait(20);
    expect(calls.customerList).toBe(2);
  });
});
