import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { LastRoute } from './last-route';
import { StorageService } from './storage/storage.service';

@Component({ template: '' })
class Blank {}

describe('LastRoute', () => {
  const setup = (saved?: string): { router: Router; storage: StorageService; last: LastRoute } => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'orders', component: Blank },
          { path: 'customer-display', component: Blank },
          { path: 'settings', component: Blank },
        ]),
      ],
    });
    const storage = TestBed.inject(StorageService);
    if (saved !== undefined) storage.set('lastUrl', saved);
    return { router: TestBed.inject(Router), storage, last: TestBed.inject(LastRoute) };
  };

  it('saves each page with its query parameters', async () => {
    const { router, storage, last } = setup();
    last.track();
    await router.navigateByUrl('/orders?view-sales-order=a1');
    expect(storage.get('lastUrl', '')).toBe('/orders?view-sales-order=a1');
    await router.navigateByUrl('/settings');
    expect(storage.get('lastUrl', '')).toBe('/settings');
  });

  it('never saves the customer display', async () => {
    const { router, storage, last } = setup('/orders');
    last.track();
    await router.navigateByUrl('/customer-display');
    expect(storage.get('lastUrl', '')).toBe('/orders');
  });

  it('starts on the saved page, or the fallback when there is none or it no longer exists', () => {
    expect(setup('/orders?view-sales-order=a1').last.startUrl('/checkout').toString()).toBe('/orders?view-sales-order=a1');
    TestBed.resetTestingModule();
    expect(setup().last.startUrl('/checkout').toString()).toBe('/checkout');
    TestBed.resetTestingModule();
    expect(setup('/components').last.startUrl('/checkout').toString()).toBe('/checkout');
    TestBed.resetTestingModule();
    expect(setup('/customer-display').last.startUrl('/checkout').toString()).toBe('/checkout');
  });
});
