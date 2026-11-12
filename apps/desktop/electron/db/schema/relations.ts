import { relations } from 'drizzle-orm';
import { auditLog } from './audit-log';
import { categories } from './categories';
import { employees } from './employees';
import { loginSessions } from './login-sessions';
import { orderLines } from './order-lines';
import { orders } from './orders';
import { payments } from './payments';
import { productBatches } from './product-batches';
import { productCategories } from './product-categories';
import { products } from './products';
import { stockMovements } from './stock-movements';

export const employeesRelations = relations(employees, ({ many }) => ({
  loginSessions: many(loginSessions),
  orders: many(orders),
  auditLog: many(auditLog),
}));

export const loginSessionsRelations = relations(loginSessions, ({ one }) => ({
  employee: one(employees, { fields: [loginSessions.employeeId], references: [employees.id] }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  employee: one(employees, { fields: [auditLog.employeeId], references: [employees.id] }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({ productLinks: many(productCategories) }));

export const productCategoriesRelations = relations(productCategories, ({ one }) => ({
  product: one(products, { fields: [productCategories.productId], references: [products.id] }),
  category: one(categories, { fields: [productCategories.categoryId], references: [categories.id] }),
}));

export const productsRelations = relations(products, ({ many }) => ({
  categoryLinks: many(productCategories),
  orderLines: many(orderLines),
  batches: many(productBatches),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  employee: one(employees, { fields: [orders.employeeId], references: [employees.id] }),
  refundOf: one(orders, { fields: [orders.refundOfOrderId], references: [orders.id], relationName: 'refunds' }),
  refunds: many(orders, { relationName: 'refunds' }),
  lines: many(orderLines),
  payments: many(payments),
}));

export const orderLinesRelations = relations(orderLines, ({ one }) => ({
  order: one(orders, { fields: [orderLines.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderLines.productId], references: [products.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));

export const productBatchesRelations = relations(productBatches, ({ one, many }) => ({
  product: one(products, { fields: [productBatches.productId], references: [products.id] }),
  movements: many(stockMovements),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  product: one(products, { fields: [stockMovements.productId], references: [products.id] }),
  batch: one(productBatches, { fields: [stockMovements.batchId], references: [productBatches.id] }),
  orderLine: one(orderLines, { fields: [stockMovements.orderLineId], references: [orderLines.id] }),
  employee: one(employees, { fields: [stockMovements.employeeId], references: [employees.id] }),
}));
