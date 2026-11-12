import { MoneyPipe } from './money.pipe';

describe('MoneyPipe', () => {
  const pipe = new MoneyPipe();

  it('formats centavos as Philippine pesos with grouping', () => {
    expect(pipe.transform(0)).toBe('₱0.00');
    expect(pipe.transform(179)).toBe('₱1.79');
    expect(pipe.transform(123450)).toBe('₱1,234.50');
    expect(pipe.transform(100000)).toBe('₱1,000.00');
    expect(pipe.transform(-2189)).toBe('-₱21.89'); // refunds
  });

  it('can format another currency when asked', () => {
    expect(pipe.transform(1234, 'USD')).toContain('12.34');
  });
});
