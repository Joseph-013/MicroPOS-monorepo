import { computed, inject, Service, signal } from '@angular/core';
import { dayOf, type DashboardData, type DashboardPeriod, type DashboardQuery, isDashboardPeriod, periodRange } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { StorageService } from '../storage/storage.service';
import type { LoadStatus } from './catalog.service';
import { refreshOnChange } from './refresh-on-change';

/** What the Dashboard remembers on this device: the period, the dates of a custom one, and whether it compares. */
interface Saved {
  period: DashboardPeriod;
  from: string;
  to: string;
  compare: boolean;
}
const isSaved = (v: unknown): v is Saved => {
  const s = v as Saved | null;
  return !!s && isDashboardPeriod(s.period) && typeof s.from === 'string' && typeof s.to === 'string' && typeof s.compare === 'boolean';
};

/**
 * The Dashboard figures over IPC for the period the person picked (remembered on this device), kept fresh while the page
 * is open (sales, stock, credit and purchase changes) and reloaded when the period changes.
 */
@Service()
export class DashboardService {
  private readonly api = inject(DESKTOP_API);
  private readonly storage = inject(StorageService);
  private readonly saved = this.storage.get<Saved>('dashboard', { period: '7d', from: dayOf(Date.now()), to: dayOf(Date.now()), compare: true }, isSaved);

  readonly period = signal<DashboardPeriod>(this.saved.period);
  readonly customFrom = signal(this.saved.from);
  readonly customTo = signal(this.saved.to);
  readonly compare = signal(this.saved.compare);

  readonly data = signal<DashboardData | null>(null);
  readonly status = signal<LoadStatus>('idle');
  private requested = 0;

  /** The days asked for, worked out from today (so "Today" is today after midnight too, on the next load). */
  readonly query = computed<DashboardQuery>(() => {
    const range = periodRange(this.period(), dayOf(Date.now()), { from: this.customFrom(), to: this.customTo() });
    return { ...range, compare: this.compare() };
  });

  constructor() {
    refreshOnChange(['sales', 'stock', 'customers', 'purchases'], () => this.status() !== 'idle', () => this.load());
  }

  /** Changes the period (and its custom dates), remembers it, and loads the figures for it. */
  async choose(change: { period?: DashboardPeriod; from?: string; to?: string; compare?: boolean }): Promise<void> {
    if (change.period) this.period.set(change.period);
    if (change.from) this.customFrom.set(change.from);
    if (change.to) this.customTo.set(change.to);
    // A custom range never ends before it starts.
    if (this.customFrom() > this.customTo()) change.from ? this.customTo.set(this.customFrom()) : this.customFrom.set(this.customTo());
    if (change.compare !== undefined) this.compare.set(change.compare);
    this.storage.set('dashboard', { period: this.period(), from: this.customFrom(), to: this.customTo(), compare: this.compare() } satisfies Saved);
    await this.load();
  }

  async load(): Promise<void> {
    if (!this.api) {
      this.status.set('error');
      return;
    }
    if (!this.data()) this.status.set('loading');
    const request = ++this.requested;
    try {
      const data = await this.api.dashboard.get(this.query());
      if (request !== this.requested) return; // the period changed while this was loading
      this.data.set(data);
      this.status.set(data ? 'ready' : 'error');
    } catch (error) {
      console.error('Failed to load the dashboard', error);
      if (request === this.requested) this.status.set('error');
    }
  }
}
