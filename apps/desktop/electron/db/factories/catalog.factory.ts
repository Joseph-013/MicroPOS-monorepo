import { faker } from '@faker-js/faker';
import type { NewCategory, NewProduct } from '../schema';
import { uuid7 } from '../uuid';
import { ean13 } from './ean13';

export const SAMPLE_CATEGORIES = ['Produce', 'Dairy', 'Bakery', 'Beverages', 'Snacks', 'Household', 'Frozen'] as const;

type CategoryName = (typeof SAMPLE_CATEGORIES)[number];

/** Realistic starter catalog (prices in cents). A product can belong to several categories. */
export const SAMPLE_PRODUCTS: readonly { name: string; categories: readonly CategoryName[]; price: number }[] = [
  { name: 'Bananas (bunch)', categories: ['Produce', 'Snacks'], price: 179 },
  { name: 'Gala Apples (3lb)', categories: ['Produce', 'Snacks'], price: 349 },
  { name: 'Roma Tomatoes (lb)', categories: ['Produce'], price: 180 },
  { name: 'Whole Milk (1 gal)', categories: ['Dairy', 'Beverages'], price: 429 },
  { name: 'Large Eggs (dozen)', categories: ['Dairy'], price: 349 },
  { name: 'Greek Yogurt (32oz)', categories: ['Dairy', 'Snacks'], price: 529 },
  { name: 'White Bread', categories: ['Bakery'], price: 299 },
  { name: 'Bagels (6pk)', categories: ['Bakery', 'Frozen'], price: 349 },
  { name: 'Orange Juice (64oz)', categories: ['Beverages', 'Produce'], price: 399 },
  { name: 'Sparkling Water (12pk)', categories: ['Beverages'], price: 549 },
  { name: 'Potato Chips', categories: ['Snacks'], price: 329 },
  { name: 'Granola Bars (8pk)', categories: ['Snacks', 'Bakery'], price: 449 },
  { name: 'Paper Towels (6 rolls)', categories: ['Household'], price: 899 },
  { name: 'Dish Soap', categories: ['Household'], price: 279 },
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
  return {
    id: uuid7(now),
    name: faker.commerce.productName(),
    sku: `PRD-${String(serial).padStart(5, '0')}`,
    plu: String(1000 + serial),
    barcode: ean13(`590${String(serial).padStart(9, '0')}`),
    price: faker.number.int({ min: 99, max: 4999 }),
    cost: null,
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
