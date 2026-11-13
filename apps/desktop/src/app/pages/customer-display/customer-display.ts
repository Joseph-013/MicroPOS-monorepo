import { Component, computed, DestroyRef, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { formatQuantity, IDLE_DISPLAY_STATE, type CustomerDisplayLine, type CustomerDisplayState } from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { AppSettings } from '../../core/settings/app-settings.service';
import { Logo } from '../../core/logo';
import { MoneyPipe } from '../../core/money.pipe';

/** How long the thank-you stays before the welcome screen returns. */
export const PAID_SCREEN_MS = 10_000;
/** How long the line that was just scanned stays highlighted. */
export const HIGHLIGHT_MS = 2_500;

/**
 * What the customer sees at the till: the items as they are scanned with a running total, a thank-you once the sale is
 * paid, a welcome in between. It only renders what Checkout publishes (`CustomerDisplayState`); it has no controls.
 */
@Component({
  imports: [Logo, MoneyPipe],
  host: { class: 'block' },
  template: `
    <div class="bg-background text-foreground flex h-svh flex-col px-10 py-8">
      <header class="flex items-center justify-between">
        <app-logo class="[&>svg]:h-10" />
        @if (shopping()) {
          <span class="text-muted-foreground text-2xl">{{ itemCount() }} {{ itemCount() === 1 ? 'item' : 'items' }}</span>
        }
      </header>

      @if (shopping()) {
        <ul #list class="mt-6 min-h-0 flex-1 overflow-y-auto" aria-label="Your items">
          @for (line of state().lines; track $index) {
            <li class="flex items-baseline justify-between gap-8 border-b px-5 py-4" [class.row-target]="highlighted() === $index">
              <div class="min-w-0">
                <p class="truncate text-4xl">{{ line.name }}</p>
                <p class="text-muted-foreground text-2xl">{{ quantity(line) }} × {{ line.unitPrice | money }}</p>
              </div>
              <p class="shrink-0 text-4xl">{{ line.total | money }}</p>
            </li>
          }
        </ul>
        <footer class="mt-4 flex items-baseline justify-between border-t-2 px-5 pt-4">
          <span class="text-4xl">Total</span>
          <span class="font-heading text-7xl">{{ state().total | money }}</span>
        </footer>
      } @else if (receipt(); as r) {
        <div class="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <p class="font-heading text-7xl">Thank you!</p>
          <p class="text-5xl">{{ r.total | money }}</p>
          @if (r.change > 0) {
            <p class="text-muted-foreground text-4xl">Change {{ r.change | money }}</p>
          }
          @if (r.onAccount > 0) {
            <p class="text-muted-foreground text-4xl">{{ r.onAccount | money }} on your account</p>
          }
        </div>
      } @else {
        <div class="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <p class="font-heading text-7xl">Welcome</p>
        </div>
      }
    </div>
  `,
})
export class CustomerDisplayPage {
  private readonly api = inject(DESKTOP_API);
  private readonly settings = inject(AppSettings);

  private readonly latest = signal<CustomerDisplayState>(IDLE_DISPLAY_STATE);
  /** The thank-you has been showing long enough; the welcome screen takes over until something new is published. */
  private readonly paidExpired = signal(false);
  protected readonly state = computed(() => (this.latest().phase === 'paid' && this.paidExpired() ? IDLE_DISPLAY_STATE : this.latest()));
  protected readonly shopping = computed(() => this.state().phase === 'shopping');
  protected readonly receipt = computed(() => (this.state().phase === 'paid' ? this.state().receipt : null));
  protected readonly itemCount = computed(() => this.state().lines.length);
  /** The line that was added or changed by the latest update, highlighted for a moment. */
  protected readonly highlighted = signal<number | null>(null);

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;
  private paidTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const destroy = inject(DestroyRef);
    if (this.api) {
      this.api.display.getState().then((state) => this.receive(state), () => undefined);
      destroy.onDestroy(this.api.display.onState((state) => this.receive(state)));
    }
    destroy.onDestroy(() => {
      clearTimeout(this.highlightTimer);
      clearTimeout(this.paidTimer);
    });
    // UI scale (Settings > Customer Display): everything here is sized in rem, so scaling the root size scales it all.
    effect(() => (document.documentElement.style.fontSize = `${this.settings.customerDisplayScale()}%`));
    destroy.onDestroy(() => (document.documentElement.style.fontSize = ''));
    // The newest line is at the bottom: keep it in view as lines are added.
    effect(() => {
      this.state();
      const list = this.list()?.nativeElement;
      if (list) queueMicrotask(() => (list.scrollTop = list.scrollHeight));
    });
  }

  private receive(next: CustomerDisplayState): void {
    const before = this.latest().lines;
    this.latest.set(next);
    this.paidExpired.set(false);
    clearTimeout(this.paidTimer);
    if (next.phase === 'paid') this.paidTimer = setTimeout(() => this.paidExpired.set(true), PAID_SCREEN_MS);

    // Highlight what just changed: the first line that is new or differs from what was shown (the last one on a tie).
    let changed: number | null = null;
    next.lines.forEach((line, i) => {
      const old = before[i];
      if (!old || old.quantityMilli !== line.quantityMilli || old.unitPrice !== line.unitPrice || old.name !== line.name) changed = i;
    });
    clearTimeout(this.highlightTimer);
    this.highlighted.set(next.phase === 'shopping' ? changed : null);
    if (changed !== null) this.highlightTimer = setTimeout(() => this.highlighted.set(null), HIGHLIGHT_MS);
  }

  protected quantity(line: CustomerDisplayLine): string {
    return `${formatQuantity(line.quantityMilli)}${line.unit === 'each' ? '' : ' ' + line.unit}`;
  }
}
