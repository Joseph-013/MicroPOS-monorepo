import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ALL_PERMISSIONS, ROLE_PRESETS, type DesktopApi, type UserInput, type UserRecord } from '@micropos/core';
import { BannerService } from '../../core/banner';
import { AuthService } from '../../core/auth/auth.service';
import { sessionUser } from '../../core/auth/testing';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { UsersPage } from './users';

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

@Component({ template: '' })
class Blank {}

const user = (id: string, name: string, over: Partial<UserRecord> = {}): UserRecord => ({
  id,
  name,
  employeeNumber: id,
  role: 'cashier',
  permissions: [...ROLE_PRESETS.cashier],
  active: true,
  pinChangeRequired: false,
  lastSignInAt: null,
  ...over,
});

function fakeApi(initial: UserRecord[], signIns = 1) {
  const rows = [...initial];
  let updateResult: Record<string, unknown> = { ok: false as const, field: 'permissions' as const, error: 'Someone must be able to manage users: this is the only one who can' };
  const calls = { created: [] as UserInput[], updated: [] as [string, UserInput][], resets: [] as [string, string][] };
  const api = {
    auth: { status: () => Promise.resolve(null), choices: () => Promise.resolve([]) },
    users: {
      list: () => Promise.resolve([...rows]),
      signInLog: () => Promise.resolve(Array.from({ length: signIns }, (_, i) => ({ id: `s${i}`, userId: 'a', userName: i === 0 ? 'Ana' : `Sign-in ${i}`, signedInAt: 1_700_000_000_000 - i * 1000, signedOutAt: null }))),
      create: (input: UserInput) => {
        calls.created.push(input);
        const created = user(`n${rows.length}`, input.name, { permissions: input.permissions, role: input.role, pinChangeRequired: true });
        rows.push(created);
        return Promise.resolve({ ok: true as const, user: created });
      },
      update: (id: string, input: UserInput) => {
        calls.updated.push([id, input]);
        return Promise.resolve(updateResult);
      },
      resetPin: (id: string, pin: string) => {
        calls.resets.push([id, pin]);
        return Promise.resolve({ ok: true as const });
      },
    },
  } as unknown as DesktopApi;
  return { api, calls, setUpdate: (r: Record<string, unknown>) => void (updateResult = r) };
}

describe('UsersPage', () => {
  let fixture: ComponentFixture<UsersPage>;
  let el: HTMLElement;
  let fake: ReturnType<typeof fakeApi>;

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await fixture.whenStable();
    }
  };
  async function open(rows: UserRecord[], signIns = 1): Promise<void> {
    fake = fakeApi(rows, signIns);
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }]), { provide: DESKTOP_API, useValue: fake.api }] });
    fixture = TestBed.createComponent(UsersPage);
    await settle();
    el = fixture.nativeElement as HTMLElement;
  }
  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
  });

  const button = (root: ParentNode, label: string): HTMLButtonElement | undefined => Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
  const type = async (selector: string, text: string, root: ParentNode): Promise<void> => {
    const input = root.querySelector(selector) as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };

  it('lists users with their role and status, and the sign-ins', async () => {
    await open([user('a', 'Ana', { role: 'admin', permissions: [...ROLE_PRESETS.admin] }), user('b', 'Ben', { permissions: ['checkout.sell'] }), user('c', 'Cy', { active: false }), user('d', 'Di', { pinChangeRequired: true })]);
    const rows = Array.from(el.querySelectorAll('[aria-label="Users"] [role="row"]')).slice(1).map((r) => Array.from(r.querySelectorAll('[role="cell"]')).map((c) => c.textContent!.trim()));
    expect(rows.map((r) => [r[0], r[2], r[4]])).toEqual([
      ['Ana', 'Admin', 'Active'],
      ['Ben', 'Custom', 'Active'],
      ['Cy', 'Cashier', 'Inactive'],
      ['Di', 'Cashier', 'New PIN due'],
    ]);
    expect(el.querySelector('[aria-label="Sign-ins"]')!.textContent).toContain('Ana');
  });

  it('pages the sign-ins, 50 at a time', async () => {
    await open([user('a', 'Ana')], 120);
    const table = el.querySelector('[aria-label="Sign-ins"]')!;
    const rows = (): number => table.querySelectorAll('[role="row"]').length - 1;
    expect(rows()).toBe(50);
    expect(el.textContent).toContain('1–50 of 120');
    (el.querySelector('button[aria-label="Next page"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.textContent).toContain('51–100 of 120');
  });

  it('adds a user starting from the cashier preset, which the switches can adjust', async () => {
    await open([]);
    button(el, 'Add user')!.click();
    await settle();
    const form = document.querySelector('#user-form')!;
    await type('#user-name', 'Sam', form);
    await type('#user-number', '2001', form);
    await type('#user-pin', '4321', form);
    ([...form.querySelectorAll('label')].find((l) => l.textContent?.includes('View sales orders'))!.querySelector('hlm-switch button') as HTMLElement).click(); // adds a permission to the preset
    await settle();
    button(form, 'Save')!.click();
    await settle();
    expect(fake.calls.created).toHaveLength(1);
    expect(fake.calls.created[0]).toMatchObject({ name: 'Sam', employeeNumber: '2001', pin: '4321', active: true });
    expect(fake.calls.created[0].permissions).toEqual(['checkout.sell', 'orders.view', 'customers.view', 'customers.payments']);
    expect(document.querySelector('#user-form')).toBeNull();
  });

  it('has no switch for signing in: a new user is simply active', async () => {
    await open([]);
    button(el, 'Add user')!.click();
    await settle();
    const form = document.querySelector('#user-form')!;
    expect(form.querySelector('[data-account-status]')).toBeNull(); // nothing to deactivate yet
    expect(form.textContent).not.toContain('Can sign in');
    await type('#user-name', 'Sam', form);
    await type('#user-number', '2001', form);
    await type('#user-pin', '4321', form);
    button(form, 'Save')!.click();
    await settle();
    expect(fake.calls.created[0]).toMatchObject({ name: 'Sam', active: true });
  });

  it('deactivates a user from its own button, after asking, and changes nothing else', async () => {
    await open([user('a', 'Ana')]);
    fake.setUpdate({ ok: true, user: user('a', 'Ana') });
    (el.querySelector('[data-row-id="a"]') as HTMLElement).click();
    await settle();
    const form = document.querySelector('#user-form')!;
    expect(form.querySelector('[data-status]')!.textContent!.trim()).toBe('Active');
    await type('#user-name', 'Ana Renamed', form); // an unsaved edit is not part of it
    button(form, 'Deactivate user')!.click();
    await settle();
    expect(fake.calls.updated).toEqual([]); // not yet: asks first
    expect(form.textContent).toContain('Deactivate Ana? They are signed out at once');
    button(form, 'Cancel')!.click();
    await settle();
    expect(document.querySelector('#user-form')).not.toBeNull(); // Cancel on the question keeps the form (the dialog's own Close is elsewhere)
  });

  it('sends active false, with the user as last saved, once confirmed', async () => {
    await open([user('a', 'Ana')]);
    fake.setUpdate({ ok: true, user: user('a', 'Ana') });
    (el.querySelector('[data-row-id="a"]') as HTMLElement).click();
    await settle();
    const form = document.querySelector('#user-form')!;
    await type('#user-name', 'Ana Renamed', form);
    button(form, 'Deactivate user')!.click();
    await settle();
    button(form, 'Deactivate')!.click();
    await settle();
    expect(fake.calls.updated).toHaveLength(1);
    expect(fake.calls.updated[0]![0]).toBe('a');
    expect(fake.calls.updated[0]![1]).toMatchObject({ name: 'Ana', active: false });
    expect(document.querySelector('#user-form')).toBeNull();
  });

  it('reactivates an inactive user with one press, and shows why when it is refused', async () => {
    await open([user('a', 'Ana', { active: false })]);
    fake.setUpdate({ ok: true, user: user('a', 'Ana') });
    (el.querySelector('[data-row-id="a"]') as HTMLElement).click();
    await settle();
    const form = document.querySelector('#user-form')!;
    expect(form.querySelector('[data-status]')!.textContent!.trim()).toBe('Inactive');
    expect(button(form, 'Deactivate user')).toBeFalsy();
    button(form, 'Reactivate user')!.click();
    await settle();
    expect(fake.calls.updated[0]![1]).toMatchObject({ active: true });
  });

  it('says why deactivating was refused (the last person who can manage users, or yourself)', async () => {
    await open([user('a', 'Ana')]);
    fake.setUpdate({ ok: false, field: 'active', error: 'You cannot deactivate yourself' });
    (el.querySelector('[data-row-id="a"]') as HTMLElement).click();
    await settle();
    const form = document.querySelector('#user-form')!;
    button(form, 'Deactivate user')!.click();
    await settle();
    button(form, 'Deactivate')!.click();
    await settle();
    expect(form.textContent).toContain('You cannot deactivate yourself');
    expect(document.querySelector('#user-form')).not.toBeNull();
  });

  describe('the row menu (right-click or long-press)', () => {
    const openMenu = async (id: string): Promise<void> => {
      (el.querySelector(`[data-row-id="${id}"]`) as HTMLElement).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
      await settle();
    };
    const items = (): string[] => [...document.querySelectorAll('[hlmDropdownMenuItem]')].map((b) => b.textContent!.trim());
    const item = (label: string): HTMLButtonElement => [...document.querySelectorAll('[hlmDropdownMenuItem]')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

    it('offers Edit and Deactivate user on an active user, and asks before deactivating', async () => {
      await open([user('a', 'Ana')]);
      fake.setUpdate({ ok: true, user: user('a', 'Ana') });
      await openMenu('a');
      expect(items()).toEqual(['Edit', 'Deactivate user']);
      item('Deactivate user').click();
      await settle();
      expect(document.body.textContent).toContain('Deactivate Ana?');
      expect(fake.calls.updated).toEqual([]);
      (document.querySelector('[hlmAlertDialogAction]') as HTMLButtonElement).click();
      await settle();
      expect(fake.calls.updated[0]![1]).toMatchObject({ name: 'Ana', active: false });
      expect(TestBed.inject(BannerService).current()?.text).toBe('Ana deactivated');
    });

    it('offers Reactivate user on an inactive one, which needs no question', async () => {
      await open([user('a', 'Ana', { active: false })]);
      fake.setUpdate({ ok: true, user: user('a', 'Ana') });
      await openMenu('a');
      expect(items()).toEqual(['Edit', 'Reactivate user']);
      item('Reactivate user').click();
      await settle();
      expect(fake.calls.updated[0]![1]).toMatchObject({ active: true });
      expect(TestBed.inject(BannerService).current()?.text).toBe('Ana reactivated');
    });

    it('does not offer to deactivate yourself, and says why when a change is refused', async () => {
      await open([user('a', 'Ana'), user('b', 'Ben')]);
      TestBed.inject(AuthService).user.set(sessionUser([], { id: 'a', name: 'Ana' }));
      await settle();
      await openMenu('a');
      expect(items()).toEqual(['Edit']); // not Deactivate: you cannot deactivate yourself
      document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
      fake.setUpdate({ ok: false, field: 'active', error: 'Someone must be able to manage users: this is the only one who can' });
      await openMenu('b');
      item('Deactivate user').click();
      await settle();
      (document.querySelector('[hlmAlertDialogAction]') as HTMLButtonElement).click();
      await settle();
      expect(TestBed.inject(BannerService).current()?.text).toContain('Someone must be able to manage users');
    });
  });

  it('does not offer to deactivate the only active user who can manage users, in the menu or the form, and says why', async () => {
    const admin = user('a', 'Ada', { permissions: [...ALL_PERMISSIONS], role: 'admin' });
    await open([admin, user('b', 'Ben')]);
    (el.querySelector('[data-row-id="a"]') as HTMLElement).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    await settle();
    const menuItem = document.querySelector('[data-last-manager]') as HTMLButtonElement;
    expect(menuItem.hasAttribute('disabled')).toBe(true);
    expect(menuItem.textContent).toContain('the only manager');
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
    (el.querySelector('[data-row-id="a"]') as HTMLElement).click();
    await settle();
    const form = document.querySelector('#user-form')!;
    expect(button(form, 'Deactivate user')!.disabled).toBe(true);
    expect(form.querySelector('[data-last-manager]')!.textContent).toContain('only active user who can manage users');
  });

  it('offers it again when another active user can manage users, but not when that one is inactive', async () => {
    const admin = (id: string, over = {}) => user(id, id, { permissions: [...ALL_PERMISSIONS], role: 'admin', ...over });
    await open([admin('a'), admin('b')]);
    (el.querySelector('[data-row-id="a"]') as HTMLElement).click();
    await settle();
    expect(button(document.querySelector('#user-form')!, 'Deactivate user')!.disabled).toBe(false);
    fixture.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
    TestBed.resetTestingModule();
    await open([admin('a'), admin('b', { active: false })]);
    (el.querySelector('[data-row-id="a"]') as HTMLElement).click();
    await settle();
    expect(button(document.querySelector('#user-form')!, 'Deactivate user')!.disabled).toBe(true);
  });

  it('shows the reason when a change is refused', async () => {
    await open([user('a', 'Ana')]);
    (el.querySelector('[data-row-id="a"]') as HTMLElement).click();
    await settle();
    const form = document.querySelector('#user-form')!;
    button(form, 'Save')!.click();
    await settle();
    expect(form.textContent).toContain('Someone must be able to manage users');
  });

  it('resets a PIN', async () => {
    await open([user('a', 'Ana')]);
    (el.querySelector('[data-row-id="a"]') as HTMLElement).click();
    await settle();
    const form = document.querySelector('#user-form')!;
    await type('#user-reset', '9999', form);
    button(form, 'Reset PIN')!.click();
    await settle();
    expect(fake.calls.resets).toEqual([['a', '9999']]);
    expect(form.textContent).toContain('PIN reset');
  });
});
