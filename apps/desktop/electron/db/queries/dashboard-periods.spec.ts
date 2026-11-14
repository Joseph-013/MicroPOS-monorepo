import { describe, expect, it } from 'vitest';
import { chartBuckets, daysInRange, granularityFor, periodRange, previousRange, shiftDay } from '@micropos/core';

describe('dashboard periods', () => {
  const today = '2026-06-15'; // a Monday

  it('works out each preset from today', () => {
    expect(periodRange('today', today)).toEqual({ from: today, to: today });
    expect(periodRange('yesterday', today)).toEqual({ from: '2026-06-14', to: '2026-06-14' });
    expect(periodRange('7d', today)).toEqual({ from: '2026-06-09', to: today });
    expect(periodRange('30d', today)).toEqual({ from: '2026-05-17', to: today });
    expect(periodRange('month', today)).toEqual({ from: '2026-06-01', to: today });
    expect(periodRange('lastMonth', today)).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    expect(periodRange('lastMonth', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' }); // across the new year
    expect(periodRange('custom', today, { from: '2026-02-01', to: '2026-02-10' })).toEqual({ from: '2026-02-01', to: '2026-02-10' });
    expect(periodRange('custom', today)).toEqual({ from: today, to: today });
  });

  it('counts days, shifts them and finds the period before', () => {
    expect(daysInRange('2026-06-09', '2026-06-15')).toBe(7);
    expect(daysInRange('2026-06-15', '2026-06-15')).toBe(1);
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(previousRange('2026-06-09', '2026-06-15')).toEqual({ from: '2026-06-02', to: '2026-06-08' });
    expect(previousRange('2026-06-01', '2026-06-30')).toEqual({ from: '2026-05-02', to: '2026-05-31' }); // as many days (30), not "last month"
    expect(previousRange('2026-06-15', '2026-06-15')).toEqual({ from: '2026-06-14', to: '2026-06-14' });
  });

  it('picks the bar size from the length of the period, so a chart has a sensible number of bars', () => {
    expect([1, 31, 32, 183, 184, 1000].map(granularityFor)).toEqual(['day', 'day', 'week', 'week', 'month', 'month']);
  });

  it('cuts a period into days, Monday-to-Sunday weeks or calendar months, clipping the ends', () => {
    expect(chartBuckets('2026-06-14', '2026-06-16', 'day')).toHaveLength(3);
    expect(chartBuckets('2026-06-10', '2026-06-24', 'week')).toEqual([
      { from: '2026-06-10', to: '2026-06-14' }, // Wednesday to Sunday
      { from: '2026-06-15', to: '2026-06-21' },
      { from: '2026-06-22', to: '2026-06-24' },
    ]);
    expect(chartBuckets('2026-01-20', '2026-03-05', 'month')).toEqual([
      { from: '2026-01-20', to: '2026-01-31' },
      { from: '2026-02-01', to: '2026-02-28' },
      { from: '2026-03-01', to: '2026-03-05' },
    ]);
    expect(chartBuckets('2026-06-15', '2026-06-15', 'week')).toEqual([{ from: '2026-06-15', to: '2026-06-15' }]);
  });
});
