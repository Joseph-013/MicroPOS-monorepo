import { type CustomerDisplayLine, type CustomerDisplayState, IDLE_DISPLAY_STATE } from '@micropos/core';

const MAX_LINES = 500;
const MAX_CENTS = 100_000_000_00;
const MAX_MILLI = 99_999_000;

const isInt = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

function line(value: unknown): CustomerDisplayLine | null {
  const v = (value ?? {}) as Record<string, unknown>;
  if (!isText(v['name'], 200) || !isText(v['unit'], 8)) return null;
  if (!isInt(v['quantityMilli'], MAX_MILLI) || !isInt(v['unitPrice'], MAX_CENTS) || !isInt(v['total'], MAX_CENTS)) return null;
  return { name: v['name'], unit: v['unit'], quantityMilli: v['quantityMilli'], unitPrice: v['unitPrice'], total: v['total'] };
}

/** What the page sent, checked: a state it can be sure the display window can draw, or the idle one. */
export function sanitizeDisplayState(value: unknown): CustomerDisplayState {
  const v = (value ?? {}) as Record<string, unknown>;
  const phase = v['phase'];
  if ((phase !== 'idle' && phase !== 'shopping' && phase !== 'paid') || !Array.isArray(v['lines']) || v['lines'].length > MAX_LINES) return IDLE_DISPLAY_STATE;
  const lines = v['lines'].map(line);
  if (lines.some((l) => l === null) || !isInt(v['total'], MAX_CENTS)) return IDLE_DISPLAY_STATE;

  let receipt: CustomerDisplayState['receipt'] = null;
  if (v['receipt'] !== null && v['receipt'] !== undefined) {
    const r = v['receipt'] as Record<string, unknown>;
    if (!isText(r['orderNumber'], 40) || !isInt(r['total'], MAX_CENTS) || !isInt(r['change'], MAX_CENTS) || !isInt(r['onAccount'], MAX_CENTS)) return IDLE_DISPLAY_STATE;
    receipt = { orderNumber: r['orderNumber'], total: r['total'], change: r['change'], onAccount: r['onAccount'] };
  }
  if (phase === 'paid' && !receipt) return IDLE_DISPLAY_STATE;
  const highlight = isInt(v['highlight'], MAX_LINES) && v['highlight'] < lines.length ? v['highlight'] : null; // a missing or out-of-range index is just no highlight
  return { phase, lines: lines as CustomerDisplayLine[], total: v['total'], highlight, receipt };
}
