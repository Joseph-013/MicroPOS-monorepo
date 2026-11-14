import { inject, Service } from '@angular/core';
import type { SalesReport } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';

/** Reports over IPC. */
@Service()
export class ReportsService {
  private readonly api = inject(DESKTOP_API);

  /** The sales summary for the days `from` to `to` inclusive (`YYYY-MM-DD`); null when it cannot be read. */
  async sales(from: string, to: string): Promise<SalesReport | null> {
    try {
      return (await this.api?.reports.sales(from, to)) ?? null;
    } catch (error) {
      console.error('Failed to load the sales report', error);
      return null;
    }
  }
}
