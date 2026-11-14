/**
 * The code printed as a QR on a receipt so the sale can be found again by scanning it: `MICROPOS-ORDER-SO-1001`. Only
 * letters, digits and dashes, so a keyboard-wedge scanner types it the same on any keyboard layout. A scan that is
 * not one of these is not an order code and goes to whatever else wants scans.
 */
export const ORDER_QR_PREFIX = 'MICROPOS-ORDER-';

export const orderQrPayload = (orderNumber: string): string => `${ORDER_QR_PREFIX}${orderNumber}`;

/** The order number inside a scanned order code ("SO-1001"), or null when the scan is something else. */
export function parseOrderQr(scanned: string): string | null {
  const match = /^MICROPOS-ORDER-([A-Z]{1,6}-\d{1,9})$/.exec(scanned.trim());
  return match ? match[1]! : null;
}
