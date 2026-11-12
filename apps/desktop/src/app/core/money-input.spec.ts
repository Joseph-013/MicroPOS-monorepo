import { formatCentsInput, parseCents } from './money-input';

describe('money input', () => {
  it('parses pesos to cents', () => {
    expect(parseCents('12')).toBe(1200);
    expect(parseCents('12.5')).toBe(1250);
    expect(parseCents('1,234.05')).toBe(123405);
    expect(parseCents('0.07')).toBe(7);
    expect(parseCents('19.99')).toBe(1999);
  });
  it('rejects empty and malformed text', () => {
    for (const bad of ['', ' ', 'abc', '-1', '1.234', '1e3', '.5']) expect(parseCents(bad)).toBeNull();
  });
  it('formats cents for editing', () => {
    expect(formatCentsInput(12350)).toBe('123.50');
    expect(formatCentsInput(null)).toBe('');
  });
});
