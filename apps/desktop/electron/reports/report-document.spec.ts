import { describe, expect, it } from 'vitest';
import { buildReportDocument, REPORT_KINDS, reportToCsv, reportToHtml, type SalesReport } from '@micropos/core';

const report: SalesReport = {
  from: '2026-06-01',
  to: '2026-06-15',
  sales: { count: 4, gross: 18_000, discounts: 500, net: 17_500 },
  voids: { count: 1, total: 2000 },
  refunds: { count: 1, total: -4000 },
  netAfterRefunds: 13_500,
  byMethod: [{ method: 'cash', amount: 6000 }, { method: 'bank_transfer', amount: 3000 }],
  credit: { given: 5000, interest: 0, paymentsReceived: [{ method: 'cash', amount: 2000 }] },
  items: [{ name: 'Feast, "large"', unit: 'each', quantityMilli: 1000, total: 6000 }, { name: 'Cheese', unit: 'kg', quantityMilli: 1500, total: 1500 }],
};
const plain = (c: number): string => (c / 100).toFixed(2);

describe('report documents', () => {
  it('has one report for each kind, the summary holding all of them', () => {
    const headings = (kind: (typeof REPORT_KINDS)[number]) => buildReportDocument(kind, report, plain).sections.map((s) => s.heading);
    expect(headings('summary')).toEqual(['Sales', 'Taken by', 'Customer credit', 'Items sold']);
    expect(headings('payments')).toEqual(['Taken by']);
    expect(headings('credit')).toEqual(['Customer credit']);
    expect(headings('items')).toEqual(['Items sold']);
  });

  it('names the period, and the sales rows with net sales in bold', () => {
    const doc = buildReportDocument('summary', report, plain);
    expect(doc.period).toBe('1 Jun 2026 to 15 Jun 2026');
    expect(buildReportDocument('items', { ...report, to: report.from }, plain).period).toBe('1 Jun 2026');
    const sales = doc.sections[0]!;
    expect(sales.rows).toEqual([['4 sales', '180.00'], ['Discounts', '-5.00'], ['1 refund', '-40.00'], ['Net sales', '135.00'], ['1 voided (not in net sales)', '20.00']]);
    expect(sales.strong).toEqual([3]);
  });

  it('writes a CSV a spreadsheet reads: plain numbers, quoted text, sections apart, a byte order mark', () => {
    const csv = reportToCsv(buildReportDocument('summary', report, plain));
    expect(csv.startsWith('﻿Sales summary\r\n1 Jun 2026 to 15 Jun 2026\r\n')).toBe(true);
    expect(csv).toContain('\r\n\r\nTaken by\r\nCash,60.00\r\nBank transfer,30.00\r\n');
    expect(csv).toContain('Item,Quantity,Total\r\n"Feast, ""large""",1,60.00\r\nCheese,1.5 kg,15.00\r\n');
  });

  it('writes printable HTML with everything escaped', () => {
    const html = reportToHtml(buildReportDocument('items', report, plain), 'Tom & Co <shop>');
    expect(html).toContain('Tom &amp; Co &lt;shop&gt;');
    expect(html).toContain('Feast, &quot;large&quot;');
    expect(html).not.toContain('<shop>');
    expect(html).not.toContain('<script');
  });
});
