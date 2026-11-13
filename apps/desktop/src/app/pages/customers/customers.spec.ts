import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { CustomerAccount, CustomerInput, CustomerRecord, DesktopApi, LedgerEntryRecord, ReceivePaymentInput } from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { BannerService } from '../../core/banner';
import { CustomerViewer } from '../../core/customer-viewer';
import { CustomersPage } from './customers';

// jsdom has no ResizeObserver (overlay code watches element sizes).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

Element.prototype.scrollIntoView ??= () => undefined;

@Component({ template: '' })
class Blank {}

const customer = (id: string, name: string, over: Partial<CustomerRecord> = {}): CustomerRecord => ({
  id,
  name,
  phone: null,
  note: null,
  creditLimit: null,
  interestMode: null,
  interestRateBp: null,
  interestStartedAt: null,
  alert: null,
  balance: 0,
  lastActivityAt: null,
  createdAt: 1,
  deletedAt: null,
  ...over,
});

/** A fake main process holding customers in memory, recording the calls it gets. */
function fakeApi(initial: CustomerRecord[]) {
  const rows = [...initial];
  const ledger = new Map<string, LedgerEntryRecord[]>();
  const calls = { created: [] as CustomerInput[], updated: [] as [string, CustomerInput][], payments: [] as ReceivePaymentInput[], removed: [] as string[][] };
  const api = {
    customers: {
      list: (options?: { includeDeleted?: boolean }) => Promise.resolve(rows.filter((c) => (options?.includeDeleted ? !!c.deletedAt : !c.deletedAt))),
      create: (input: CustomerInput) => {
        calls.created.push(input);
        const c = customer(`n${rows.length}`, input.name, { phone: input.phone, note: input.note, creditLimit: input.creditLimit, interestMode: input.interestMode, interestRateBp: input.interestRateBp });
        rows.push(c);
        return Promise.resolve({ ok: true as const, customer: c });
      },
      update: (id: string, input: CustomerInput) => {
        calls.updated.push([id, input]);
        const c = rows.find((r) => r.id === id)!;
        Object.assign(c, input);
        return Promise.resolve({ ok: true as const, customer: c });
      },
      remove: (ids: string[]) => {
        calls.removed.push(ids);
        const blocked = rows.filter((c) => ids.includes(c.id) && c.balance !== 0).map((c) => c.name);
        for (const c of rows) if (ids.includes(c.id) && c.balance === 0) c.deletedAt = 5;
        return Promise.resolve({ removed: ids.length - blocked.length, blocked });
      },
      restore: (ids: string[]) => {
        for (const c of rows) if (ids.includes(c.id)) c.deletedAt = null;
        return Promise.resolve();
      },
      account: (id: string): Promise<CustomerAccount | null> => {
        const c = rows.find((r) => r.id === id);
        return Promise.resolve(c ? { customer: { ...c }, entries: ledger.get(id) ?? [] } : null);
      },
      interestDefaults: () => Promise.resolve({ orderRateBp: 500, totalRateBp: 200 }),
      saveInterestDefaults: () => Promise.resolve(true),
      alertCount: () => Promise.resolve(0),
      receivePayment: (input: ReceivePaymentInput) => {
        calls.payments.push(input);
        const c = rows.find((r) => r.id === input.customerId)!;
        if (input.amount > c.balance) return Promise.resolve({ ok: false as const, field: 'amount' as const, error: 'That is more than they owe' });
        c.balance -= input.amount;
        ledger.set(c.id, [
          { id: 'p1', type: 'payment', amount: -input.amount, balanceAfter: c.balance, orderId: null, orderNumber: null, method: input.method, reference: input.reference, note: null, employeeName: 'Register', at: 9 },
          ...(ledger.get(c.id) ?? []),
        ]);
        return Promise.resolve({ ok: true as const, balance: c.balance });
      },
    },
  } as unknown as DesktopApi;
  ledger.set('a', [
    { id: 'c1', type: 'charge', amount: 70_000, balanceAfter: 70_000, orderId: 'o1', orderNumber: 'SO-1001', method: null, reference: null, note: null, employeeName: 'Register', at: 1 },
  ]);
  return { api, calls, rows };
}

const SAMPLE = () => [
  customer('a', 'Aling Nena', { phone: '0917 111 2222', balance: 70_000, creditLimit: 200_000, lastActivityAt: Date.UTC(2026, 10, 12, 10) }),
  customer('b', 'Bong', { balance: 0 }),
  customer('c', 'Cora', { balance: -5_000, lastActivityAt: Date.UTC(2026, 10, 10, 10) }),
  customer('d', 'Dodong', { balance: 1_000, phone: '0999 000 0000' }),
];

describe('CustomersPage', () => {
  let fixture: ComponentFixture<CustomersPage>;
  let el: HTMLElement;
  let fake: ReturnType<typeof fakeApi>;

  async function open(rows = SAMPLE(), url = '/customers'): Promise<void> {
    fake = fakeApi(rows);
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }]), { provide: DESKTOP_API, useValue: fake.api }] });
    TestBed.inject(CustomerViewer); // started at launch by the app root, before the first navigation
    await TestBed.inject(Router).navigateByUrl(url);
    fixture = TestBed.createComponent(CustomersPage);
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
  const text = (selector: string): string => document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ') ?? '';

  it('lists customers by name with what each owes, credit shown as such, and their limit', async () => {
    await open();
    expect(names()).toEqual(['Aling Nena', 'Bong', 'Cora', 'Dodong']);
    const row = (name: string): string => rowOf(name).textContent!.replace(/\s+/g, ' ');
    expect(row('Aling Nena')).toContain('₱700.00');
    expect(row('Aling Nena')).toContain('₱2,000.00'); // the limit
    expect(row('Cora')).toContain('Credit ₱50.00');
    expect(rowOf('Bong').querySelectorAll('[role="cell"]')[3].textContent!.trim()).toBe('-'); // settled
  });

  it('has a button by the title with the number of concerns, opening the list, whose rows open the account', async () => {
    await open([
      customer('a', 'Aling Nena', { balance: 600_000, alert: { overAmount: 500_000, unpaidDays: 45 } }),
      customer('b', 'Bakery Boy', { balance: 900_000, alert: { overAmount: 500_000, unpaidDays: null } }),
      customer('c', 'Cora', { balance: 100 }),
    ]);
    const concerns = el.querySelector('button[title="Credit concerns"]') as HTMLButtonElement;
    expect(concerns.textContent?.trim()).toBe('2');
    expect(concerns.getAttribute('aria-label')).toBe('2 credit concerns');
    concerns.click();
    await settle();
    const dialog = document.querySelector('hlm-dialog-content, [role="dialog"]')!;
    expect(dialog.textContent).toContain('Credit concerns');
    const rows = Array.from(dialog.querySelectorAll('li button')).map((b) => Array.from(b.querySelectorAll('span > span, :scope > span:last-child')).map((x) => x.textContent!.trim()));
    expect(rows).toEqual([
      ['Bakery Boy', 'Over ₱5,000.00', '₱9,000.00'],
      ['Aling Nena', 'Over ₱5,000.00 · Unpaid 45 days', '₱6,000.00'],
    ]); // largest balance first
    (dialog.querySelector('li button') as HTMLElement).click();
    await settle();
    expect(TestBed.inject(Router).url).toContain('view-customer=b');
  });

  it('filters the concerns by name and by reason', async () => {
    await open([
      customer('a', 'Aling Nena', { balance: 600_000, alert: { overAmount: 500_000, unpaidDays: 45 } }),
      customer('b', 'Bakery Boy', { balance: 900_000, alert: { overAmount: 500_000, unpaidDays: null } }),
      customer('c', 'Cora', { balance: 100_000, alert: { overAmount: null, unpaidDays: 40 } }),
    ]);
    (el.querySelector('button[title="Credit concerns"]') as HTMLElement).click();
    await settle();
    const dialog = document.querySelector('hlm-dialog-content, [role="dialog"]')!;
    const shown = (): string[] => Array.from(dialog.querySelectorAll('li button')).map((b) => b.querySelector('span span')!.textContent!.trim());
    expect(shown()).toEqual(['Bakery Boy', 'Aling Nena', 'Cora']);
    await type('input[aria-label="Filter name"]', 'nena', dialog);
    expect(shown()).toEqual(['Aling Nena']);
    await type('input[aria-label="Filter name"]', 'zzz', dialog);
    expect(dialog.textContent).toContain('No concerns match');
    await type('input[aria-label="Filter name"]', '', dialog);
    const trigger = dialog.querySelector('hlm-select-trigger') as HTMLElement;
    (trigger.querySelector('button') ?? trigger).click();
    await settle();
    (Array.from(document.querySelectorAll('hlm-select-item')).find((i) => i.textContent?.trim() === 'Unpaid too long') as HTMLElement).click();
    await settle();
    expect(shown()).toEqual(['Aling Nena', 'Cora']);
  });

  it('has no concerns button when nothing needs attention', async () => {
    await open();
    expect(el.querySelector('button[title="Credit concerns"]')).toBeNull();
  });

  it('sorts by what they owe and filters by name, phone and balance', async () => {
    await open();
    (Array.from(el.querySelectorAll('[role="columnheader"] button')).find((b) => b.textContent?.trim() === 'Owes') as HTMLElement).click();
    await fixture.whenStable();
    expect(names()).toEqual(['Aling Nena', 'Dodong', 'Bong', 'Cora']); // most owed first
    await type('input[aria-label="Filter name"]', 'ong');
    expect(names()).toEqual(['Dodong', 'Bong']);
    await type('input[aria-label="Filter name"]', '');
    await type('input[aria-label="Filter phone"]', '0917');
    expect(names()).toEqual(['Aling Nena']);
    (el.querySelector('button[aria-label="Reset filters"]') as HTMLElement).click();
    const page = fixture.componentInstance as unknown as { balanceFilter: { set(v: string): void } };
    page.balanceFilter.set('owes');
    await fixture.whenStable();
    expect(names().sort()).toEqual(['Aling Nena', 'Dodong']);
    page.balanceFilter.set('credit');
    await fixture.whenStable();
    expect(names()).toEqual(['Cora']);
  });

  it('a click opens the account over the page (?view-customer=<id>) and highlights the row', async () => {
    await open();
    rowOf('Aling Nena').click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/customers?view-customer=a');
    const dialog = text('#customer-account');
    expect(dialog).toContain('Aling Nena');
    expect(dialog).toContain('Owes');
    expect(dialog).toContain('₱700.00');
    expect(dialog).toContain('Credit limit');
    expect(dialog).toContain('SO-1001'); // the sale that put it on account
    expect(el.querySelector('.row-target')!.closest('[data-row-id]')?.getAttribute('data-row-id')).toBe('a');
  });

  it('records a payment towards the balance and shows the new balance and entry', async () => {
    await open();
    rowOf('Aling Nena').click();
    await settle();
    const dialog = document.querySelector('#customer-account')!;
    button(dialog, 'Receive payment')!.click();
    await settle();
    button(dialog, 'Full balance')!.click();
    await settle();
    expect((dialog.querySelector('#pay-amount') as HTMLInputElement).value).toBe('700.00');
    await type('#pay-amount', '300', dialog);
    await type('#pay-reference', 'OR-77', dialog);
    button(dialog, 'Record payment')!.click();
    await settle();

    expect(fake.calls.payments).toEqual([{ customerId: 'a', amount: 30_000, method: 'cash', reference: 'OR-77' }]);
    expect(TestBed.inject(BannerService).current()?.text).toBe('₱300.00 received from Aling Nena');
    const after = text('#customer-account');
    expect(after).toContain('₱400.00'); // what they owe now
    expect(after).toContain('Payment · Cash');
    expect(after).toContain('OR-77');
    expect(dialog.querySelector('#pay-amount')).toBeNull(); // the form closed
    expect(rowOf('Aling Nena').textContent).toContain('₱400.00'); // and the list shows it
  });

  it('shows a refused payment\'s reason and keeps the form', async () => {
    await open();
    rowOf('Dodong').click();
    await settle();
    const dialog = document.querySelector('#customer-account')!;
    button(dialog, 'Receive payment')!.click();
    await settle();
    await type('#pay-amount', '50', dialog); // owes only 10.00
    button(dialog, 'Record payment')!.click();
    await settle();
    expect(text('#customer-account')).toContain('That is more than they owe');
    expect(dialog.querySelector('#pay-amount')).not.toBeNull();
    await type('#pay-amount', '', dialog);
    button(dialog, 'Record payment')!.click();
    await settle();
    expect(text('#customer-account')).toContain('Enter the amount received');
  });

  it('offers no payment form to a customer who owes nothing', async () => {
    await open();
    rowOf('Bong').click();
    await settle();
    expect(button(document.querySelector('#customer-account')!, 'Receive payment')).toBeUndefined();
  });

  it('adds a customer, with an optional credit limit', async () => {
    await open();
    button(el, 'Add customer')!.click();
    await settle();
    const dialog = document.querySelector('#customer-form')!;
    await type('#cu-name', 'Elena', dialog);
    await type('#cu-phone', '0918', dialog);
    await type('#cu-limit', '1,500', dialog);
    button(dialog, 'Save')!.click();
    await settle();
    expect(fake.calls.created).toEqual([{ name: 'Elena', phone: '0918', note: null, creditLimit: 150_000, interestMode: null, interestRateBp: null }]);
    expect(names()).toContain('Elena');
    expect(TestBed.inject(BannerService).current()?.text).toBe('Customer added');
  });

  it('adds interest to a customer, starting from the saved default rate for the kind', async () => {
    await open();
    button(el, 'Add customer')!.click();
    await settle();
    const dialog = document.querySelector('#customer-form')!;
    expect(dialog.querySelector('#cu-rate')).toBeNull(); // most customers have none
    await type('#cu-name', 'Elena', dialog);
    const trigger = dialog.querySelector('hlm-select-trigger') as HTMLElement;
    (trigger.querySelector('button') ?? trigger).click();
    await settle();
    (Array.from(document.querySelectorAll('hlm-select-item')).find((i) => i.textContent?.trim() === 'Per sales order') as HTMLElement).click();
    await settle();
    expect((dialog.querySelector('#cu-rate') as HTMLInputElement).value).toBe('5');
    await type('#cu-rate', '2.5', dialog);
    button(dialog, 'Save')!.click();
    await settle();
    expect(fake.calls.created).toEqual([{ name: 'Elena', phone: null, note: null, creditLimit: null, interestMode: 'order', interestRateBp: 250 }]);
  });

  it('asks for a valid rate once interest is chosen', async () => {
    await open();
    button(el, 'Add customer')!.click();
    await settle();
    const dialog = document.querySelector('#customer-form')!;
    await type('#cu-name', 'Elena', dialog);
    const trigger = dialog.querySelector('hlm-select-trigger') as HTMLElement;
    (trigger.querySelector('button') ?? trigger).click();
    await settle();
    (Array.from(document.querySelectorAll('hlm-select-item')).find((i) => i.textContent?.trim() === 'On total credit') as HTMLElement).click();
    await settle();
    expect((dialog.querySelector('#cu-rate') as HTMLInputElement).value).toBe('2');
    await type('#cu-rate', '250', dialog);
    button(dialog, 'Save')!.click();
    await settle();
    expect(dialog.textContent).toContain('Enter a rate between 0.01% and 100%');
    expect(fake.calls.created).toEqual([]);
  });

  it('asks for a name and a valid limit', async () => {
    await open();
    button(el, 'Add customer')!.click();
    await settle();
    const dialog = document.querySelector('#customer-form')!;
    button(dialog, 'Save')!.click();
    await settle();
    expect(dialog.textContent).toContain('Enter a name');
    await type('#cu-name', 'X', dialog);
    await type('#cu-limit', 'abc', dialog);
    button(dialog, 'Save')!.click();
    await settle();
    expect(dialog.textContent).toContain('Enter a valid credit limit');
    expect(fake.calls.created).toEqual([]);
  });

  it('bulk delete counts only customers without a balance, and the confirmation lists them', async () => {
    await open();
    (el.querySelector('[aria-label="Select Aling Nena"]') as HTMLElement).click();
    (el.querySelector('[aria-label="Select Bong"]') as HTMLElement).click();
    await settle();
    expect(el.textContent).toContain('2 selected');
    expect(button(el, 'Delete 1')).toBeTruthy(); // Aling Nena owes, so only Bong can go
    button(el, 'Delete 1')!.click();
    await settle();
    const confirm = document.querySelector('hlm-alert-dialog-content')!;
    expect(Array.from(confirm.querySelectorAll('app-confirm-items li span:first-child')).map((e) => e.textContent!.trim())).toEqual(['Bong']);
    (confirm.querySelector('[hlmAlertDialogAction]') as HTMLElement).click();
    await settle();
    expect(fake.calls.removed).toEqual([['b']]);
    expect(names()).not.toContain('Bong');
  });

  it('?highlight=<id> shows the customer\'s row highlighted and uses the parameter up', async () => {
    const many = Array.from({ length: 80 }, (_, i) => customer(`c${i}`, `Customer ${String(i).padStart(2, '0')}`));
    await open(many, '/customers?highlight=c70');
    expect(el.querySelector('app-pager')?.textContent?.replace(/\s+/g, ' ')).toContain('Page 2 of 2');
    expect(el.querySelector('.row-target')!.closest('[data-row-id]')?.getAttribute('data-row-id')).toBe('c70');
    expect(TestBed.inject(Router).url).toBe('/customers');
  });
});
