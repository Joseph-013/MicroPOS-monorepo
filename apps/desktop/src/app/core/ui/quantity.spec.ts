import { formatQuantity, lineTotal, parseQuantityMilli } from '@micropos/core';

describe('quantity helpers', () => {
  it('parses typed quantities into exact thousandths', () => {
    expect(parseQuantityMilli('1')).toBe(1000);
    expect(parseQuantityMilli('12')).toBe(12000);
    expect(parseQuantityMilli('1.25')).toBe(1250);
    expect(parseQuantityMilli('0.5')).toBe(500);
    expect(parseQuantityMilli('.5')).toBe(500);
    expect(parseQuantityMilli('0.001')).toBe(1);
    expect(parseQuantityMilli('99999')).toBe(99_999_000);
    expect(parseQuantityMilli(' 2 ')).toBe(2000);
    expect(parseQuantityMilli('0.1')).toBe(100); // no floating-point surprises (0.1 * 1000 = 100.00000000000001)
  });

  it('rejects anything that is not a positive amount with up to 3 decimals', () => {
    for (const bad of ['', '.', '0', '0.', '0.000', '1.', '1.2345', '100000', '-1', 'abc', '1e3', '1,5', '1.2.3']) {
      expect(parseQuantityMilli(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('formats thousandths without trailing zeros', () => {
    expect(formatQuantity(1000)).toBe('1');
    expect(formatQuantity(1250)).toBe('1.25');
    expect(formatQuantity(-500)).toBe('-0.5'); // a fraction below one keeps its sign
    expect(formatQuantity(-1250)).toBe('-1.25');
    expect(formatQuantity(-2000)).toBe('-2');
    expect(formatQuantity(500)).toBe('0.5');
    expect(formatQuantity(1)).toBe('0.001');
    expect(formatQuantity(12_340)).toBe('12.34');
    expect(formatQuantity(99_999_000)).toBe('99999');
  });

  it('round-trips and prices a line in whole cents', () => {
    expect(parseQuantityMilli(formatQuantity(1250))).toBe(1250);
    expect(lineTotal(179, 1000)).toBe(179);
    expect(lineTotal(179, 2500)).toBe(448); // 447.5 rounds up
    expect(lineTotal(1000, 250)).toBe(250);
    expect(lineTotal(333, 3000)).toBe(999);
  });
});
