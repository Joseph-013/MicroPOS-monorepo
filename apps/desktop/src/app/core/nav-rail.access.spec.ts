import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DESKTOP_API } from './api/desktop-api';
import { AuthService } from './auth/auth.service';
import { fakeAuthApi, sessionUser } from './auth/testing';
import { NavRail } from './nav-rail';

describe('NavRail access', () => {
  async function render(permissions: Parameters<typeof sessionUser>[0]): Promise<string> {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', children: [] }]), { provide: DESKTOP_API, useValue: fakeAuthApi({ status: sessionUser(permissions) }).api }],
    });
    await TestBed.inject(AuthService).whenReady();
    const fixture = TestBed.createComponent(NavRail);
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
});
