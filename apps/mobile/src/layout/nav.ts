import {
  ChartColumn,
  LayoutDashboard,
  LayoutGrid,
  Package,
  Receipt,
  ShoppingCart,
  Smartphone,
  Truck,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react-native';

/** A nav entry: a screen (`id` is the route) or a group of entries. Mirrors the desktop's nav rail. */
export interface NavItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  children?: NavItem[];
}

export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'checkout', label: 'Checkout', icon: ShoppingCart },
  {
    id: 'items',
    label: 'Items',
    icon: Package,
    children: [
      { id: 'items-products', label: 'Products' },
      { id: 'items-inventory', label: 'Inventory' },
      { id: 'items-categories', label: 'Categories' },
    ],
  },
  { id: 'orders', label: 'Sales Orders', icon: Receipt },
  { id: 'customers', label: 'Customers', icon: Users },
  {
    id: 'purchasing',
    label: 'Purchasing',
    icon: Truck,
    children: [
      { id: 'purchasing-purchases', label: 'Purchases' },
      { id: 'purchasing-suppliers', label: 'Suppliers' },
    ],
  },
  { id: 'reports', label: 'Reports', icon: ChartColumn },
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'users', label: 'Users', icon: UserCog },
  // Developer-only: the component gallery is not in release builds.
  ...(__DEV__ ? [{ id: 'components', label: 'Components', icon: LayoutGrid }] : []),
];

export const SETTINGS: NavItem = { id: 'settings', label: 'Settings' };

export function findLabel(id: string): string {
  const walk = (items: NavItem[]): string | undefined => {
    for (const i of items) {
      if (i.id === id) return i.label;
      const hit = i.children && walk(i.children);
      if (hit) return hit;
    }
  };
  return walk([...NAV, SETTINGS]) ?? id;
}
