import { Routes } from '@angular/router';
import { devRoutes } from '../environments/dev-tools';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'checkout' },
  {
    path: 'checkout',
    title: 'Checkout',
    loadComponent: () => import('./pages/checkout/checkout').then((m) => m.CheckoutPage),
  },
  { path: 'items', pathMatch: 'full', redirectTo: 'items/products' },
  {
    path: 'items/products',
    title: 'Products',
    loadComponent: () => import('./pages/products/products').then((m) => m.ProductsPage),
  },
  {
    path: 'items/overview',
    title: 'Inventory overview',
    loadComponent: () => import('./pages/inventory-overview/inventory-overview').then((m) => m.InventoryOverviewPage),
  },
  {
    path: 'items/inventory',
    title: 'Inventory',
    loadComponent: () => import('./pages/inventory/inventory').then((m) => m.InventoryPage),
  },
  {
    path: 'items/categories',
    title: 'Categories',
    loadComponent: () => import('./pages/categories/categories').then((m) => m.CategoriesPage),
  },
  {
    path: 'orders',
    title: 'Sales Orders',
    loadComponent: () => import('./pages/orders/orders').then((m) => m.OrdersPage),
  },
  {
    path: 'customers',
    title: 'Customers',
    loadComponent: () => import('./pages/customers/customers').then((m) => m.CustomersPage),
  },
  {
    path: 'purchases',
    title: 'Purchases',
    loadComponent: () => import('./pages/purchases/purchases').then((m) => m.PurchasesPage),
  },
  {
    path: 'suppliers',
    title: 'Suppliers',
    loadComponent: () => import('./pages/suppliers/suppliers').then((m) => m.SuppliersPage),
  },
  {
    path: 'settings',
    title: 'Settings',
    loadComponent: () => import('./pages/settings').then((m) => m.SettingsPage),
  },
  // Developer-only routes (the component gallery): empty in production builds.
  ...devRoutes,
];
