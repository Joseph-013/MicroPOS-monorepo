import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { devRoutes } from '../environments/dev-tools';
import { requires } from './core/auth/permission.guard';
import { LastRoute } from './core/last-route';

export const routes: Routes = [
  // Opens on the page that was showing when the app was closed (Checkout the first time).
  { path: '', pathMatch: 'full', redirectTo: () => inject(LastRoute).startUrl('/checkout') },
  {
    path: 'checkout',
    ...requires('checkout.sell'),
    title: 'Checkout',
    loadComponent: () => import('./pages/checkout/checkout').then((m) => m.CheckoutPage),
  },
  { path: 'items', pathMatch: 'full', redirectTo: 'items/products' },
  {
    path: 'items/products',
    ...requires('catalog.view'),
    title: 'Products',
    loadComponent: () => import('./pages/products/products').then((m) => m.ProductsPage),
  },
  {
    path: 'items/overview',
    ...requires('catalog.view'),
    title: 'Inventory overview',
    loadComponent: () => import('./pages/inventory-overview/inventory-overview').then((m) => m.InventoryOverviewPage),
  },
  {
    path: 'items/inventory',
    ...requires('inventory.manage'),
    title: 'Inventory',
    loadComponent: () => import('./pages/inventory/inventory').then((m) => m.InventoryPage),
  },
  {
    path: 'items/categories',
    ...requires('catalog.view'),
    title: 'Categories',
    loadComponent: () => import('./pages/categories/categories').then((m) => m.CategoriesPage),
  },
  {
    path: 'orders',
    ...requires('orders.view'),
    title: 'Sales Orders',
    loadComponent: () => import('./pages/orders/orders').then((m) => m.OrdersPage),
  },
  {
    path: 'reports',
    ...requires('reports.view'),
    title: 'Reports',
    loadComponent: () => import('./pages/reports/reports').then((m) => m.ReportsPage),
  },
  {
    path: 'customers',
    ...requires('customers.view'),
    title: 'Customers',
    loadComponent: () => import('./pages/customers/customers').then((m) => m.CustomersPage),
  },
  {
    path: 'purchases',
    ...requires('purchasing.manage'),
    title: 'Purchases',
    loadComponent: () => import('./pages/purchases/purchases').then((m) => m.PurchasesPage),
  },
  {
    path: 'suppliers',
    ...requires('purchasing.manage'),
    title: 'Suppliers',
    loadComponent: () => import('./pages/suppliers/suppliers').then((m) => m.SuppliersPage),
  },
  {
    // Shown in the customer-facing window (see `electron/display/`), not reached from the navigation.
    path: 'customer-display',
    title: 'MicroPOS',
    loadComponent: () => import('./pages/customer-display/customer-display').then((m) => m.CustomerDisplayPage),
  },
  {
    path: 'users',
    title: 'Users',
    ...requires('users.manage'),
    loadComponent: () => import('./pages/users/users').then((m) => m.UsersPage),
  },
  {
    path: 'settings',
    title: 'Settings',
    loadComponent: () => import('./pages/settings').then((m) => m.SettingsPage),
  },
  // Developer-only routes (the component gallery): empty in production builds.
  ...devRoutes,
];
