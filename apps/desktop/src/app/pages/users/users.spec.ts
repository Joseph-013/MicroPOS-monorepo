import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ROLE_PRESETS, type DesktopApi, type UserInput, type UserRecord } from '@micropos/core';
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
        return Promise.resolve({ ok: false as const, field: 'permissions' as const, error: 'Someone must be able to manage users: this is the only one who can' });
      },
      resetPin: (id: string, pin: string) => {
        calls.resets.push([id, pin]);
        return Promise.resolve({ ok: true as const });
      },
    },
  } as unknown as DesktopApi;
  return { api, calls };
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
    expect(fake.calls.created[0].permissions).toEqual(['checkout.sell', 'orders.view', 'customers.view', 'customers.payments', 'cash.manage']);
    expect(document.querySelector('#user-form')).toBeNull();
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
