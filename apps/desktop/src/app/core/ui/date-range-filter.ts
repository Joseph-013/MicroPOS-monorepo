import { CdkConnectedOverlay, CdkOverlayOrigin } from '@angular/cdk/overlay';
import { Component, computed, input, model, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCalendar, lucideCircleX } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { FLOATING_POSITIONS } from '../keypad/overlay-positions';

const DAY_MS = 86_400_000;

/** `yyyy-mm-dd` of a date, in local time (what a date input holds). */
const toInput = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const longDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
/** A `yyyy-mm-dd` value as a local date at noon (avoids the day shifting with the time zone). */
const parse = (value: string): Date => new Date(`${value}T12:00:00`);

/**
 * A compact date-range filter for a table header: one button showing the current range ("Any date", "Nov 9, 2026",
 * "Nov 3 – Nov 9"), with a circled-x that clears it, which opens a small panel with the From and To dates and a few
 * presets. A first date is a single day: the end date follows it, until you change or clear the end.
 *
 *   <app-date-range-filter label="Created" [(from)]="createdFrom" [(to)]="createdTo" />
 *
 * `future` swaps the presets to look ahead (expiry dates) instead of back (creation dates).
 */
@Component({
  selector: 'app-date-range-filter',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, NgIcon, HlmButtonImports, HlmInputImports, HlmInputGroupImports, HlmLabelImports],
  providers: [provideIcons({ lucideCalendar, lucideCircleX })],
  host: { class: 'block' },
  template: `
    <div hlmInputGroup cdkOverlayOrigin #origin="cdkOverlayOrigin">
      <button
        type="button"
        class="flex h-full min-w-0 flex-1 items-center gap-2 px-2.5 text-start text-sm"
        [class.text-muted-foreground]="!active()"
        [attr.aria-label]="label() + ' date range'"
        aria-haspopup="dialog"
        [attr.aria-expanded]="open()"
        (click)="open.set(!open())"
      >
        <ng-icon name="lucideCalendar" size="14" class="shrink-0" />
        <span class="truncate">{{ summary() }}</span>
      </button>
      @if (active()) {
        <hlm-input-group-addon align="inline-end">
          <button hlmInputGroupButton size="icon-xs" type="button" [attr.aria-label]="'Clear ' + label().toLowerCase() + ' dates'" (click)="clear()">
            <ng-icon name="lucideCircleX" />
          </button>
        </hlm-input-group-addon>
      }
    </div>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayHasBackdrop]="true"
      cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
      (backdropClick)="open.set(false)"
      (detach)="open.set(false)"
    >
      <div
        role="dialog"
        [attr.aria-label]="label() + ' dates'"
        class="bg-popover text-popover-foreground blueprint flex w-[22rem] flex-col gap-3 p-3 text-sm shadow-lg"
        (keydown.escape)="open.set(false)"
      >
        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-1.5">
            <label hlmLabel class="flex-col items-stretch gap-1.5">From
              <input hlmInput type="date" class="text-sm" [attr.aria-label]="label() + ' from'" [value]="from()" [attr.max]="to() || null" (input)="setFrom($any($event.target).value)" />
            </label>
          </div>
          <div class="flex flex-col gap-1.5">
            <label hlmLabel class="flex-col items-stretch gap-1.5">To
              <input hlmInput type="date" class="text-sm" [attr.aria-label]="label() + ' to'" [value]="to()" [attr.min]="from() || null" (input)="to.set($any($event.target).value)" />
            </label>
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5">
          @for (preset of presets(); track preset.label) {
            <button hlmBtn variant="outline" size="sm" type="button" class="px-3" (click)="apply(preset.days)">{{ preset.label }}</button>
          }
        </div>
        <div class="flex justify-between border-t pt-3">
          <button hlmBtn variant="ghost" type="button" class="px-3" [disabled]="!active()" (click)="clear()">Clear</button>
          <button hlmBtn type="button" class="px-5" (click)="open.set(false)">Done</button>
        </div>
      </div>
    </ng-template>
  `,
})
export class DateRangeFilter {
  /** Names the filter for the button and the date fields, e.g. "Created". */
  readonly label = input.required<string>();
  /** Presets look ahead (expiry dates) rather than back. */
  readonly future = input(false);
  /** The first and last day, as `yyyy-mm-dd`; empty means open-ended. */
  readonly from = model('');
  readonly to = model('');

  protected readonly open = signal(false);
  protected readonly positions = FLOATING_POSITIONS.slice(0, 2);
  protected readonly active = computed(() => !!(this.from() || this.to()));

  protected readonly summary = computed(() => {
    const [from, to] = [this.from(), this.to()];
    if (from && to) return from === to ? longDate.format(parse(from)) : `${shortDate.format(parse(from))} – ${longDate.format(parse(to))}`;
    if (from) return `From ${longDate.format(parse(from))}`;
    if (to) return `Until ${longDate.format(parse(to))}`;
    return 'Any date';
  });

  protected readonly presets = computed(() =>
    this.future()
      ? [
          { label: 'Today', days: 0 },
          { label: 'Next 7 days', days: 7 },
          { label: 'Next 30 days', days: 30 },
        ]
      : [
          { label: 'Today', days: 0 },
          { label: 'Last 7 days', days: -7 },
          { label: 'Last 30 days', days: -30 },
        ],
  );

  /** A first date is a single day: the end follows it (clear or change the end to widen the range). */
  protected setFrom(value: string): void {
    this.from.set(value);
    if (value && !this.to()) this.to.set(value);
  }

  /** `days` is 0 for today, positive to look ahead from today, negative to look back to today. */
  protected apply(days: number): void {
    const today = new Date();
    const other = new Date(today.getTime() + days * DAY_MS);
    const [a, b] = days < 0 ? [other, today] : [today, other];
    this.from.set(toInput(a));
    this.to.set(toInput(b));
  }

  protected clear(): void {
    this.from.set('');
    this.to.set('');
  }
}
