import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { buildReportDocument, type ExportFormat, type ExportResult, type ReportKind, reportToCsv, reportToHtml, type SalesReport } from '@micropos/core';

const pesos = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
/** A plain number for a spreadsheet: 1234.5 -> "1234.50". */
const plain = (cents: number): string => (cents / 100).toFixed(2);

const fileName = (kind: ReportKind, r: SalesReport, ext: string): string => `${kind}-${r.from}${r.from === r.to ? '' : `_to_${r.to}`}.${ext}`;

/**
 * Saves a report as CSV or PDF (the person chooses where, starting in Downloads) or prints it with the system's own
 * print dialog (which also lists "Save as PDF" and any installed printer, receipt or not). The PDF and the printout are
 * drawn from the same HTML in a window that is never shown. Closing a dialog is `canceled`, not an error.
 */
export async function exportReport(kind: ReportKind, report: SalesReport, format: ExportFormat, parent: BrowserWindow | null, shopName: string): Promise<ExportResult> {
  try {
    if (format === 'csv') {
      const file = await choose(parent, fileName(kind, report, 'csv'), 'CSV file', 'csv');
      if (!file) return { ok: false, canceled: true, error: 'Canceled' };
      fs.writeFileSync(file, reportToCsv(buildReportDocument(kind, report, plain)), 'utf8');
      return { ok: true, savedTo: file };
    }
    const html = reportToHtml(buildReportDocument(kind, report, (c) => pesos.format(c / 100)), shopName);
    if (format === 'pdf') {
      const file = await choose(parent, fileName(kind, report, 'pdf'), 'PDF file', 'pdf');
      if (!file) return { ok: false, canceled: true, error: 'Canceled' };
      fs.writeFileSync(file, await render(html, (w) => w.webContents.printToPDF({ pageSize: 'A4', printBackground: true })));
      return { ok: true, savedTo: file };
    }
    return await render(html, (w) => new Promise<ExportResult>((resolve) => w.webContents.print({ silent: false, printBackground: true }, (success, reason) => resolve(success ? { ok: true } : /cancel/i.test(reason) ? { ok: false, canceled: true, error: 'Canceled' } : { ok: false, error: reason || 'Could not print' }))));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function choose(parent: BrowserWindow | null, name: string, label: string, ext: string): Promise<string | null> {
  const options = { defaultPath: path.join(app.getPath('downloads'), name), filters: [{ name: label, extensions: [ext] }] };
  const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
  return result.canceled || !result.filePath ? null : result.filePath;
}

async function render<T>(html: string, use: (window: BrowserWindow) => Promise<T>): Promise<T> {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await use(window);
  } finally {
    window.destroy();
  }
}
