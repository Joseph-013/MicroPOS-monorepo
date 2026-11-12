/** EAN-13 check digit for a 12-digit base. */
export function ean13CheckDigit(base12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** A valid EAN-13 from a numeric payload (padded to 12 digits). */
export function ean13(payload: number | string): string {
  const base = String(payload).padStart(12, '0').slice(-12);
  return `${base}${ean13CheckDigit(base)}`;
}
