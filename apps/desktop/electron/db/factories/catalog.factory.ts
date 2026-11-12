import { faker } from '@faker-js/faker';
import type { NewCategory, NewProduct, ProductTracking, ProductUnit } from '../schema';
import { uuid7 } from '../uuid';
import { ean13 } from './ean13';
import { isScaleBarcode, KNOWN_BARCODES, scalePlu } from './known-barcodes';

export const SAMPLE_CATEGORIES = ['Produce', 'Dairy', 'Bakery', 'Beverages', 'Snacks', 'Household', 'Frozen'] as const;

type CategoryName = (typeof SAMPLE_CATEGORIES)[number];

/** Realistic starter catalog (prices in cents). A product can belong to several categories. */
export const SAMPLE_PRODUCTS: readonly { name: string; categories: readonly CategoryName[]; price: number; unit?: ProductUnit; tracking?: ProductTracking; shelfLifeDays?: number }[] = [
  { name: 'Bananas (bunch)', categories: ['Produce', 'Snacks'], price: 179, tracking: 'expiry', shelfLifeDays: 6 },
  { name: 'Gala Apples (3lb)', categories: ['Produce', 'Snacks'], price: 349 },
  // Weighed: the price is per unit and the quantity is the weight (needs a code: a PLU in the barcode field).
  { name: 'Roma Tomatoes', categories: ['Produce'], price: 180, unit: 'lb', tracking: 'expiry', shelfLifeDays: 5 },
  { name: 'Ground Beef', categories: ['Frozen'], price: 899, unit: 'kg', tracking: 'expiry', shelfLifeDays: 4 },
  { name: 'Cheddar Cheese', categories: ['Dairy'], price: 1299, unit: 'kg', tracking: 'expiry', shelfLifeDays: 30 },
  { name: 'Whole Milk (1 gal)', categories: ['Dairy', 'Beverages'], price: 429, tracking: 'expiry', shelfLifeDays: 10 },
  { name: 'Large Eggs (dozen)', categories: ['Dairy'], price: 349, tracking: 'expiry', shelfLifeDays: 28 },
  { name: 'Greek Yogurt (32oz)', categories: ['Dairy', 'Snacks'], price: 529, tracking: 'expiry', shelfLifeDays: 14 },
  { name: 'White Bread', categories: ['Bakery'], price: 299, tracking: 'expiry', shelfLifeDays: 5 },
  { name: 'Bagels (6pk)', categories: ['Bakery', 'Frozen'], price: 349, tracking: 'batch' },
  { name: 'Orange Juice (64oz)', categories: ['Beverages', 'Produce'], price: 399 },
  { name: 'Sparkling Water (12pk)', categories: ['Beverages'], price: 549 },
  { name: 'Potato Chips', categories: ['Snacks'], price: 329 },
  { name: 'Granola Bars (8pk)', categories: ['Snacks', 'Bakery'], price: 449 },
  { name: 'Paper Towels (6 rolls)', categories: ['Household'], price: 899, tracking: 'quantity' },
  { name: 'Dish Soap', categories: ['Household'], price: 279, tracking: 'quantity' },
  { name: 'Frozen Pizza', categories: ['Frozen', 'Snacks'], price: 549 },
  { name: 'Frozen Mixed Vegetables', categories: ['Frozen', 'Produce'], price: 249 },
];

export function buildCategory(overrides: Partial<NewCategory> = {}, now = Date.now()): NewCategory {
  return {
    id: uuid7(now),
    name: faker.commerce.department(),
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** `serial` keeps sku/barcode unique across a run. */
export function buildProduct(serial: number, overrides: Partial<NewProduct> = {}, now = Date.now()): NewProduct {
  const price = overrides.price ?? faker.number.int({ min: 99, max: 4999 });
  return {
    id: uuid7(now),
    name: faker.commerce.productName(),
    sku: `PRD-${String(serial).padStart(5, '0')}`,
    // Counted goods have an EAN barcode; weighed ones get a short PLU instead (set by the seeder).
    barcode: ean13(`590${String(serial).padStart(9, '0')}`),
    price,
    // Cost is a bit more than half the price, so margins are positive but vary.
    cost: Math.round(price * faker.number.float({ min: 0.55, max: 0.8 })),
    unit: 'each',
    tracking: 'none',
    shelfLifeDays: null,
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * One product per known barcode with faker-generated details: a name, a price, a category choice (made by the
 * seeder) and a mix of stock tracking so the inventory pages have something to show.
 */
export function buildKnownProducts(firstSerial: number, now = Date.now()): NewProduct[] {
  return KNOWN_BARCODES.map((barcode, i) => {
    const tracking = faker.helpers.weightedArrayElement<ProductTracking>([
      { weight: 6, value: 'none' },
      { weight: 2, value: 'quantity' },
      { weight: 2, value: 'expiry' },
    ]);
    // A scale label stands for a product sold by weight: its code is the PLU inside the label, priced per kg.
    const weighed = isScaleBarcode(barcode);
    return buildProduct(
      firstSerial + i,
      {
        barcode: weighed ? scalePlu(barcode) : barcode,
        unit: weighed ? 'kg' : 'each',
        ...(weighed ? { price: faker.number.int({ min: 199, max: 2499 }) } : {}),
        tracking,
        shelfLifeDays: tracking === 'expiry' ? faker.number.int({ min: 5, max: 90 }) : null,
      },
      now,
    );
  });
}
