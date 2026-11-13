import { IDLE_DISPLAY_STATE } from '@micropos/core';
import { describe, expect, it } from 'vitest';
import { sanitizeDisplayState } from './state';

const line = { name: 'Milk', unit: 'each', quantityMilli: 2_000, unitPrice: 4_000, total: 8_000 };

describe('sanitizeDisplayState', () => {
  it('passes a valid shopping state through', () => {
    const state = { phase: 'shopping', lines: [line], total: 8_000, highlight: 0, receipt: null };
    expect(sanitizeDisplayState(state)).toEqual(state);
  });

  it('passes a paid state with its receipt', () => {
    const state = { phase: 'paid', lines: [line], total: 8_000, highlight: null, receipt: { orderNumber: 'SO-1001', total: 8_000, change: 2_000, onAccount: 0 } };
    expect(sanitizeDisplayState(state)).toEqual(state);
  });

  it('drops extra fields', () => {
    expect(sanitizeDisplayState({ phase: 'idle', lines: [], total: 0, highlight: null, receipt: null, evil: 'x' })).toEqual(IDLE_DISPLAY_STATE);
  });

  it('keeps the highlighted line only when it is one of the lines', () => {
    const base = { phase: 'shopping', lines: [line, line], total: 16_000, receipt: null };
    expect(sanitizeDisplayState({ ...base, highlight: 1 }).highlight).toBe(1);
    expect(sanitizeDisplayState({ ...base, highlight: 2 }).highlight).toBeNull(); // past the end
    expect(sanitizeDisplayState({ ...base, highlight: -1 }).highlight).toBeNull();
    expect(sanitizeDisplayState({ ...base, highlight: 'last' }).highlight).toBeNull();
    expect(sanitizeDisplayState(base).highlight).toBeNull(); // an older page that does not send it
  });

  it('falls back to idle for anything malformed', () => {
    for (const bad of [
      null,
      'shopping',
      { phase: 'shopping' },
      { phase: 'dancing', lines: [], total: 0, receipt: null },
      { phase: 'shopping', lines: [{ ...line, name: 7 }], total: 0, receipt: null },
      { phase: 'shopping', lines: [{ ...line, total: -1 }], total: 0, receipt: null },
      { phase: 'shopping', lines: [{ ...line, quantityMilli: 1.5 }], total: 0, receipt: null },
      { phase: 'shopping', lines: [line], total: 'free', receipt: null },
      { phase: 'shopping', lines: Array.from({ length: 501 }, () => line), total: 0, receipt: null },
      { phase: 'paid', lines: [line], total: 8_000, receipt: null }, // paid needs a receipt
      { phase: 'paid', lines: [line], total: 8_000, receipt: { orderNumber: 'x', total: 1 } },
    ]) {
      expect(sanitizeDisplayState(bad)).toEqual(IDLE_DISPLAY_STATE);
    }
  });
});
