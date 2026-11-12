/**
 * Text entered in a money field -> integer cents, or null when empty or not a valid amount.
 * Accepts "12", "12.5", "12.50", ",": thousands separators are ignored. More than two decimals is invalid.
 */
export function parseCents(text: string): number | null {
  const clean = text.trim().replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** Integer cents -> text for a money field: 12350 -> "123.50"; null -> "". */
export function formatCentsInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}
