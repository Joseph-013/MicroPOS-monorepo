import { inject, Service } from '@angular/core';
import type { DailyReport, PrintResult } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';

/** Reports over IPC. */
@Service()
export class ReportsService {
  private readonly api = inject(DESKTOP_API);

  /** The daily sales report of a day (`YYYY-MM-DD`); null when it cannot be read. */
  async daily(day: string): Promise<DailyReport | null> {
    try {
      return (await this.api?.reports.daily(day)) ?? null;
    } catch (error) {
      console.error('Failed to load the daily report', error);
      return null;
    }
  }

  /** Prints the day's report on the receipt printer (or saves it as an image while debugging). */
  async print(day: string): Promise<PrintResult> {
    try {
      return (await this.api?.printer.printDailyReport(day)) ?? { ok: false, code: 'unknown', error: 'Not connected to the database' };
    } catch (error) {
      console.error('Failed to print the daily report', error);
      return { ok: false, code: 'unknown', error: 'Could not print the report' };
    }
  }
}
