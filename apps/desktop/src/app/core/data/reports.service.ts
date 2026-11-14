import { inject, Service } from '@angular/core';
import type { ExportFormat, ExportResult, ReportKind, SalesReport } from '@micropos/core';
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

  /** Saves the report as CSV or PDF, or prints it with the system's print dialog. */
  async export(kind: ReportKind, from: string, to: string, format: ExportFormat): Promise<ExportResult> {
    try {
      return (await this.api?.reports.export(kind, from, to, format)) ?? { ok: false, error: 'Not connected to the database' };
    } catch (error) {
      console.error('Failed to export the report', error);
      return { ok: false, error: 'Could not export the report' };
    }
  }
}
