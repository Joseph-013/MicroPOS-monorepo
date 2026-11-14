import { inject, Service, signal } from '@angular/core';
import type { DashboardData } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import type { LoadStatus } from './catalog.service';
import { refreshOnChange } from './refresh-on-change';

/** The Dashboard figures over IPC, kept fresh while the page is open (sales, stock, credit and purchase changes). */
@Service()
export class DashboardService {
  private readonly api = inject(DESKTOP_API);

  readonly data = signal<DashboardData | null>(null);
  readonly status = signal<LoadStatus>('idle');

  constructor() {
    refreshOnChange(['sales', 'stock', 'customers', 'purchases'], () => this.status() !== 'idle', () => this.load());
  }

  async load(): Promise<void> {
    if (!this.api) {
      this.status.set('error');
      return;
    }
    if (!this.data()) this.status.set('loading');
    try {
      this.data.set(await this.api.dashboard.get());
      this.status.set('ready');
    } catch (error) {
      console.error('Failed to load the dashboard', error);
      this.status.set('error');
    }
  }
}
