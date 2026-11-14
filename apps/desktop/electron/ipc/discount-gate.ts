/** Whether a checkout order takes anything off (a line discount or the order discount): it needs `discounts.give`. */
export function givesDiscount(input: unknown): boolean {
  const o = input as { discount?: unknown; lines?: { discount?: unknown }[] } | null;
  return (typeof o?.discount === 'number' && o.discount > 0) || (Array.isArray(o?.lines) && o.lines.some((l) => typeof l?.discount === 'number' && l.discount > 0));
}
