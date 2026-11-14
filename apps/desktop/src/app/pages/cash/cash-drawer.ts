import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { type CashField, type CashMovementType, MAX_CASH_NOTE, MAX_CASH_REASON } from '@micropos/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { BannerService } from '../../core/banner';
import { CashService } from '../../core/data/cash.service';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { MoneyPipe } from '../../core/money.pipe';
import { parseCents } from '../../core/money-input';
import { AppSettings } from '../../core/settings/app-settings.service';

type Mode = 'idle' | 'in' | 'out' | 'close';

/**
 * Cash drawer: open it with the counted float, record cash put in or taken out by hand, and close it by counting what
 * is there. The count is blind: nothing here says what the drawer should hold while it is open; closing shows how the
 * count compared (over, short or right).
 */
@Component({
  imports: [DatePipe, MoneyPipe, OnScreenKeypadDirective, HlmBadgeImports, HlmButtonImports, HlmCardImports, HlmInputImports, HlmLabelImports],
  template: `
    <div class="mx-auto grid w-full max-w-xl gap-3">
      <section hlmCard class="gap-0">
        <header class="flex min-h-(--control-height) items-center justify-between gap-3 px-4 pb-3">
          <h1 class="text-2xl">Cash drawer</h1>
          @if (session(); as s) {
            <span hlmBadge variant="success">Open</span>
          } @else {
            <span hlmBadge variant="outline">Closed</span>
          }
        </header>

        @if (session(); as s) {
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 border-t px-4 py-3 text-sm">
            <dt class="text-muted-foreground">Opened</dt>
            <dd class="truncate">{{ s.openedAt | date: 'MMM d, h:mm a' }}{{ s.openedBy ? ' by ' + s.openedBy : '' }}</dd>
            <dt class="text-muted-foreground">Opening float</dt>
            <dd>{{ s.openingFloat | money }}</dd>
          </dl>

          @if (mode() === 'idle') {
            <div class="flex flex-wrap gap-2 border-t px-4 py-3">
              <button hlmBtn variant="outline" type="button" class="px-4" (click)="start('in')">Cash in</button>
              <button hlmBtn variant="outline" type="button" class="px-4" (click)="start('out')">Cash out</button>
              <button hlmBtn type="button" class="ms-auto px-5" (click)="start('close')">Close drawer</button>
            </div>
          } @else if (mode() === 'close') {
            <form class="grid gap-3 border-t px-4 py-3" (submit)="$event.preventDefault(); close()">
              <div class="flex flex-col gap-2">
                <label hlmLabel data-required for="cd-count">Cash counted</label>
                <input
                  hlmInput
                  id="cd-count"
                  type="text"
                  appOnScreenKeypad
                  [keypadWholeDigits]="7"
                  [keypadDecimals]="2"
                  [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
                  [forceInvalid]="invalid('countedCash')"
                  [value]="amount()"
                  (input)="amount.set($any($event.target).value)"
                />
                @if (errorFor('countedCash'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
              </div>
              <div class="flex flex-col gap-2">
                <label hlmLabel for="cd-note">Note</label>
                <input hlmInput id="cd-note" type="text" [attr.maxlength]="maxNote" [forceInvalid]="invalid('note')" [value]="note()" (input)="note.set($any($event.target).value)" />
                @if (errorFor('note'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
              </div>
              @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
              <div class="flex justify-end gap-2">
                <button hlmBtn variant="outline" type="button" class="px-4" (click)="cancel()">Cancel</button>
                <button hlmBtn type="submit" class="px-5" [disabled]="saving()">Close drawer</button>
              </div>
            </form>
          } @else {
            <form class="grid gap-3 border-t px-4 py-3" (submit)="$event.preventDefault(); addMovement()">
              <div class="flex flex-col gap-2">
                <label hlmLabel data-required for="cd-amount">{{ mode() === 'in' ? 'Cash in' : 'Cash out' }}</label>
                <input
                  hlmInput
                  id="cd-amount"
                  type="text"
                  appOnScreenKeypad
                  [keypadWholeDigits]="7"
                  [keypadDecimals]="2"
                  [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
                  [forceInvalid]="invalid('amount')"
                  [value]="amount()"
                  (input)="amount.set($any($event.target).value)"
                />
                @if (errorFor('amount'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
              </div>
              <div class="flex flex-col gap-2">
                <label hlmLabel data-required for="cd-reason">Reason</label>
                <input hlmInput id="cd-reason" type="text" [attr.maxlength]="maxReason" [forceInvalid]="invalid('reason')" [value]="reason()" (input)="reason.set($any($event.target).value)" />
                @if (errorFor('reason'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
              </div>
              @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
              <div class="flex justify-end gap-2">
                <button hlmBtn variant="outline" type="button" class="px-4" (click)="cancel()">Cancel</button>
                <button hlmBtn type="submit" class="px-5" [disabled]="saving()">Save</button>
              </div>
            </form>
          }

          @if (movements().length) {
            <ul class="divide-border flex flex-col divide-y border-t" aria-label="Cash in and out">
              @for (m of movements(); track m.id) {
                <li class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-4 py-2">
                  <div class="min-w-0">
                    <p class="truncate">{{ m.reason }}</p>
                    <p class="text-muted-foreground text-xs">{{ m.at | date: 'h:mm a' }}{{ m.employeeName ? ' · ' + m.employeeName : '' }}</p>
                  </div>
                  <p class="text-right" [class.text-destructive]="m.type === 'out'">{{ m.type === 'out' ? '-' : '+' }}{{ m.amount | money }}</p>
                </li>
              }
            </ul>
          }
        } @else {
          <form class="grid gap-3 border-t px-4 py-3" (submit)="$event.preventDefault(); open()">
            <div class="flex flex-col gap-2">
              <label hlmLabel data-required for="cd-float">Cash counted into the drawer</label>
              <input
                hlmInput
                id="cd-float"
                type="text"
                appOnScreenKeypad
                [keypadWholeDigits]="7"
                [keypadDecimals]="2"
                [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
                [forceInvalid]="invalid('openingFloat')"
                [value]="amount()"
                (input)="amount.set($any($event.target).value)"
              />
              @if (errorFor('openingFloat'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
            </div>
            @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
            <div class="flex justify-end">
              <button hlmBtn type="submit" class="px-5" [disabled]="saving()">Open drawer</button>
            </div>
          </form>
        }
      </section>

      @if (last(); as l) {
        @if (!session()) {
          <section hlmCard class="gap-0" data-last-count>
            <header class="px-4 pb-3"><h2 class="text-xl">Last count</h2></header>
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 border-t px-4 py-3 text-sm">
              <dt class="text-muted-foreground">Closed</dt>
              <dd class="truncate">{{ l.closedAt! | date: 'MMM d, h:mm a' }}{{ l.closedBy ? ' by ' + l.closedBy : '' }}</dd>
              <dt class="text-muted-foreground">Counted</dt>
              <dd>{{ l.countedCash! | money }}</dd>
              <dt class="text-muted-foreground">Expected</dt>
              <dd>{{ l.expectedCash! | money }}</dd>
              <dt>{{ l.variance === 0 ? 'Matches' : l.variance! < 0 ? 'Short' : 'Over' }}</dt>
              <dd class="font-heading text-xl" [class.text-destructive]="l.variance !== 0">{{ l.variance === 0 ? '' : (abs(l.variance!) | money) }}</dd>
              @if (l.note) {
                <dt class="text-muted-foreground">Note</dt>
                <dd class="min-w-0 break-words select-text">{{ l.note }}</dd>
              }
            </dl>
          </section>
        }
      }
    </div>
  `,
})
export class CashDrawerPage implements OnInit {
  protected readonly settings = inject(AppSettings);
  private readonly cash = inject(CashService);
  private readonly banner = inject(BannerService);

  protected readonly session = computed(() => this.cash.state().session);
  protected readonly movements = computed(() => this.cash.state().movements);
  protected readonly last = computed(() => this.cash.state().lastClosed);
  protected readonly maxNote = MAX_CASH_NOTE;
  protected readonly maxReason = MAX_CASH_REASON;
  protected readonly abs = Math.abs;

  protected readonly mode = signal<Mode>('idle');
  protected readonly amount = signal('');
  protected readonly reason = signal('');
  protected readonly note = signal('');
  protected readonly saving = signal(false);
  private readonly problem = signal<{ field: CashField | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem()?.field === null ? this.problem()!.error : null));

  ngOnInit(): void {
    void this.cash.load();
  }

  protected invalid(field: CashField): boolean {
    return this.problem()?.field === field;
  }
  protected errorFor(field: CashField): string | null {
    return this.invalid(field) ? this.problem()!.error : null;
  }

  protected start(mode: Mode): void {
    this.reset();
    this.mode.set(mode);
  }
  protected cancel(): void {
    this.reset();
  }
  private reset(): void {
    this.mode.set('idle');
    this.amount.set('');
    this.reason.set('');
    this.note.set('');
    this.problem.set(null);
  }

  /** The typed amount in cents; null (and the problem shown against `field`) when it is not money. */
  private cents(field: CashField, allowEmpty = false): number | null {
    const text = this.amount().trim();
    const cents = text === '' && allowEmpty ? 0 : parseCents(text);
    if (cents === null) this.problem.set({ field, error: field === 'amount' ? 'Enter an amount' : 'Enter the cash counted' });
    return cents;
  }

  /** Runs a save: shows the problem the main process names, or leaves the form and says so in a banner. */
  private async run<T>(call: () => Promise<{ ok: true; value: T } | { ok: false; field: CashField | null; error: string }>, done: string): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      const result = await call();
      if (result.ok) {
        this.reset();
        this.banner.success(done, { key: 'cash-drawer' });
      } else this.problem.set({ field: result.field, error: result.error });
    } finally {
      this.saving.set(false);
    }
  }

  protected async open(): Promise<void> {
    this.problem.set(null);
    const cents = this.cents('openingFloat');
    if (cents !== null) await this.run(() => this.cash.open(cents), 'Drawer opened');
  }

  protected async addMovement(): Promise<void> {
    this.problem.set(null);
    const cents = this.cents('amount');
    if (cents === null) return;
    const type: CashMovementType = this.mode() === 'in' ? 'in' : 'out';
    await this.run(() => this.cash.addMovement({ type, amount: cents, reason: this.reason() }), type === 'in' ? 'Cash in recorded' : 'Cash out recorded');
  }

  protected async close(): Promise<void> {
    this.problem.set(null);
    const cents = this.cents('countedCash');
    if (cents !== null) await this.run(() => this.cash.close({ countedCash: cents, note: this.note().trim() || null }), 'Drawer closed');
  }
}
