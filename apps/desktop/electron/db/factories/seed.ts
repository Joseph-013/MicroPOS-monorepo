import { faker } from '@faker-js/faker';
import type { AppDatabase } from '../index';
import {
  auditLog,
  categories,
  employees,
  loginSessions,
  type NewProductCategory,
  orderLines,
  orders,
  payments,
  productBatches,
  productCategories,
  products,
  settings,
  stockMovements,
} from '../schema';
import { seedAdmin } from '../seeders/admin.seeder';
import { uuid7 } from '../uuid';
import { buildCategory, buildProduct, SAMPLE_CATEGORIES, SAMPLE_PRODUCTS } from './catalog.factory';
import { buildEmployee, DUMMY_PIN } from './employee.factory';
import { SeedStock } from './inventory.factory';
import { buildRefund, buildSale, type SaleDraft } from './sale.factory';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface SeedOptions {
  /** Same seed = same data (names, prices, picks). Timestamps are relative to now. */
  seed?: number;
  /** Sales to generate (refunds are extra). */
  orders?: number;
  /** How far back sales are spread. */
  days?: number;
  extraProducts?: number;
  extraCashiers?: number;
}

export interface SeedSummary {
  employees: number;
  categories: number;
  products: number;
  orders: number;
  refunds: number;
  voided: number;
  loginSessions: number;
  auditEntries: number;
  credentials: { employeeNumber: string; name: string; role: string; pin: string }[];
}

const chunks = <T>(rows: T[], size = 400): T[][] =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));

/**
 * Fills an empty database with consistent dummy data: employees, catalog, sales (with lines
 * and payments), a few voids and refunds, login sessions, audit entries and settings.
 * Everything is inserted in one transaction.
 */
export function seedDatabase(db: AppDatabase, options: SeedOptions = {}): SeedSummary {
  faker.seed(options.seed ?? 42);
  const now = Date.now();
  const days = options.days ?? 30;
  const start = now - days * DAY;

  // People -------------------------------------------------------------------------
  // The admin is the baseline account every fresh database has; reuse it (or create it).
  const admin = seedAdmin(db);
  const staff = [
    buildEmployee({ name: 'Morgan Manager', employeeNumber: '1002', role: 'manager' }, start - DAY),
    buildEmployee({ name: 'Casey Cashier', employeeNumber: '1003', role: 'cashier' }, start - DAY),
    ...Array.from({ length: options.extraCashiers ?? 2 }, (_, i) =>
      buildEmployee({ employeeNumber: String(1004 + i), role: 'cashier' }, start - DAY),
    ),
  ];
  const [manager] = staff;
  const sellers = staff;

  // Catalog ------------------------------------------------------------------------
  const categoryRows = SAMPLE_CATEGORIES.map((name, i) => buildCategory({ name, sortOrder: i }, start - DAY));
  const categoryByName = new Map(categoryRows.map((c) => [c.name, c.id!]));
  const productRows = [
    ...SAMPLE_PRODUCTS.map((p, i) => buildProduct(
        i + 1,
        { name: p.name, price: p.price, unit: p.unit ?? 'each', tracking: p.tracking ?? 'none', shelfLifeDays: p.shelfLifeDays ?? null, ...(p.unit && p.unit !== 'each' ? { barcode: String(4000 + i) } : {}) },
        start - DAY,
      )),
    ...Array.from({ length: options.extraProducts ?? 24 }, (_, i) => buildProduct(SAMPLE_PRODUCTS.length + i + 1, {}, start - DAY)),
  ];
  // Every product belongs to one to three categories.
  const productCategoryRows: NewProductCategory[] = productRows.flatMap((product, i) => {
    const names =
      i < SAMPLE_PRODUCTS.length
        ? SAMPLE_PRODUCTS[i].categories
        : faker.helpers.arrayElements(categoryRows, { min: 1, max: 3 }).map((c) => c.name);
    return names.map((name) => ({ productId: product.id!, categoryId: categoryByName.get(name)! }));
  });
  const sellable = productRows.map((p) => ({ id: p.id!, name: p.name, price: p.price, unit: p.unit ?? 'each' }));

  // Sales --------------------------------------------------------------------------
  const times = Array.from({ length: options.orders ?? 120 }, () => {
    const day = faker.number.int({ min: 0, max: days - 1 });
    const minute = faker.number.int({ min: 8 * 60, max: 20 * 60 });
    return Math.min(start + day * DAY + minute * 60_000, now - HOUR);
  }).sort((a, b) => a - b);

  const drafts: SaleDraft[] = times.map((at) =>
    buildSale({
      orderNumber: '',
      employeeId: faker.helpers.arrayElement(sellers).id!,
      products: sellable,
      at,
      status: faker.datatype.boolean(0.05) ? 'voided' : 'completed',
    }),
  );

  const refunds: SaleDraft[] = [];
  for (const sale of drafts) {
    if (sale.order.status !== 'completed' || !faker.datatype.boolean(0.05)) continue;
    const at = (sale.order.completedAt ?? sale.order.createdAt!) + faker.number.int({ min: HOUR, max: 3 * HOUR });
    if (at > now) continue;
    refunds.push(buildRefund(sale, { orderNumber: '', employeeId: manager.id!, at }));
    sale.order.status = 'refunded';
  }

  // Number everything in creation order.
  const all = [...drafts, ...refunds].sort((a, b) => a.order.createdAt! - b.order.createdAt!);

  // Stock: opening deliveries before the first sale, then every sale draws from them first-expiring-first-out and
  // every refund puts its stock back, so quantities on hand are consistent with the sales history.
  const stock = new SeedStock(
    productRows.map((p) => ({
      id: p.id!,
      tracking: p.tracking ?? 'none',
      unit: p.unit ?? 'each',
      cost: p.cost ?? null,
      shelfLifeDays: p.shelfLifeDays ?? null,
    })),
    now,
    start,
  );
  const linesByOrder = new Map(all.map((d) => [d.order.id!, d.lines]));
  for (const d of all) {
    if (d.order.status === 'voided') continue; // never sold
    const at = d.order.completedAt ?? d.order.createdAt!;
    for (const line of d.lines) {
      if (!line.productId) continue;
      if (line.quantityMilli > 0) {
        line.unitCost = stock.allocate(line.productId, line.id, line.quantityMilli, at);
      } else if (d.order.refundOfOrderId) {
        const original = linesByOrder.get(d.order.refundOfOrderId)?.find((l) => l.productId === line.productId);
        if (original) {
          stock.restock(original.id, line.id, at);
          line.unitCost = original.unitCost ?? null;
        }
      }
    }
  }
  all.forEach((draft, i) => (draft.order.orderNumber = `SO-${1001 + i}`));

  // Login sessions: one closed session per employee per working day, plus the manager signed in now.
  const sessionSpans = new Map<string, { employeeId: string; first: number; last: number }>();
  for (const { order } of all) {
    const key = `${order.employeeId}:${Math.floor(order.createdAt! / DAY)}`;
    const span = sessionSpans.get(key) ?? { employeeId: order.employeeId, first: order.createdAt!, last: order.createdAt! };
    span.last = Math.max(span.last, order.createdAt!);
    sessionSpans.set(key, span);
  }
  const sessionRows = [
    ...[...sessionSpans.values()].map((s) => ({
      id: uuid7(s.first),
      employeeId: s.employeeId,
      loggedInAt: s.first - 15 * 60_000,
      loggedOutAt: s.last + 15 * 60_000,
    })),
    { id: uuid7(now), employeeId: manager.id!, loggedInAt: now - 2 * HOUR, loggedOutAt: null },
  ];

  // Audit log -----------------------------------------------------------------------
  const auditRows = [
    ...staff.map((e) => ({
      id: uuid7(e.createdAt),
      employeeId: admin.id,
      action: 'employee.create',
      entity: 'employee',
      entityId: e.id!,
      detail: { employeeNumber: e.employeeNumber, role: e.role },
      at: e.createdAt!,
    })),
    ...all
      .filter((d) => d.order.status === 'voided')
      .map((d) => ({
        id: uuid7(d.order.createdAt!),
        employeeId: manager.id!,
        action: 'order.void',
        entity: 'order',
        entityId: d.order.id!,
        detail: { orderNumber: d.order.orderNumber, reason: 'Customer changed their mind' },
        at: d.order.updatedAt!,
      })),
    ...refunds.map((d) => ({
      id: uuid7(d.order.createdAt!),
      employeeId: manager.id!,
      action: 'order.refund',
      entity: 'order',
      entityId: d.order.id!,
      detail: { orderNumber: d.order.orderNumber, refundOf: d.order.refundOfOrderId },
      at: d.order.createdAt!,
    })),
  ];

  db.transaction((tx) => {
    for (const rows of chunks(staff)) tx.insert(employees).values(rows).run();
    for (const rows of chunks(categoryRows)) tx.insert(categories).values(rows).run();
    for (const rows of chunks(productRows)) tx.insert(products).values(rows).run();
    for (const rows of chunks(productCategoryRows)) tx.insert(productCategories).values(rows).run();
    for (const rows of chunks(all.map((d) => d.order))) tx.insert(orders).values(rows).run();
    for (const rows of chunks(all.flatMap((d) => d.lines))) tx.insert(orderLines).values(rows).run();
    for (const rows of chunks(stock.batches)) tx.insert(productBatches).values(rows).run();
    for (const rows of chunks(stock.movements)) tx.insert(stockMovements).values(rows).run();
    for (const rows of chunks(all.flatMap((d) => d.payments))) tx.insert(payments).values(rows).run();
    for (const rows of chunks(sessionRows)) tx.insert(loginSessions).values(rows).run();
    for (const rows of chunks(auditRows)) tx.insert(auditLog).values(rows).run();
    tx.insert(settings)
      .values([
        { key: 'store.name', value: 'MicroPOS Demo Store' },
        { key: 'store.currency', value: 'PHP' },
        { key: 'receipt.footer', value: 'Thank you for shopping with us!' },
      ])
      .run();
  });

  return {
    employees: staff.length + 1,
    categories: categoryRows.length,
    products: productRows.length,
    orders: drafts.length,
    refunds: refunds.length,
    voided: drafts.filter((d) => d.order.status === 'voided').length,
    loginSessions: sessionRows.length,
    auditEntries: auditRows.length,
    credentials: [
      { employeeNumber: admin.employeeNumber, name: admin.name, role: 'admin', pin: admin.pin ?? '(unchanged)' },
      ...staff.map((e) => ({ employeeNumber: e.employeeNumber, name: e.name, role: e.role!, pin: DUMMY_PIN })),
    ],
  };
}
