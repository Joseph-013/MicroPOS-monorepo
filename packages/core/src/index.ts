// Pure business logic only: no Node, DOM, Electron or React Native imports.
// Money is integer minor units (cents) to avoid float errors.
export type Money = number;

export interface LineItem {
  sku: string;
  unitPrice: Money;
  qty: number;
}

export function subtotal(items: LineItem[]): Money {
  return items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
}
