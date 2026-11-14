/** Staff accounts, what each may do, and the shapes the sign-in calls pass around. Pure: no platform imports. */

export const USER_ROLES = ['admin', 'manager', 'cashier'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface PermissionInfo {
  id: string;
  label: string;
  /** What switching it on lets the person do, in a sentence. */
  description: string;
  group: string;
}

/** Everything a user can be allowed to do. Each is switched on or off per user. */
export const PERMISSIONS = [
  { id: 'checkout.sell', group: 'Sales', label: 'Sell at checkout', description: 'Use Checkout to ring up and complete sales.' },
  { id: 'orders.view', group: 'Sales', label: 'View sales orders', description: 'Open the Sales Orders page and see past sales.' },
  { id: 'orders.reverse', group: 'Sales', label: 'Void and refund sales', description: 'Cancel a sale or give money back.' },
  { id: 'customers.view', group: 'Customers', label: 'View customers', description: 'Open the Customers page and their accounts.' },
  { id: 'customers.manage', group: 'Customers', label: 'Change customers', description: 'Add, edit, delete and restore customers.' },
  { id: 'customers.payments', group: 'Customers', label: 'Receive customer payments', description: 'Record payments against what a customer owes.' },
  { id: 'discounts.give', group: 'Sales', label: 'Give discounts', description: 'Take an amount or a percent off an item or a whole sale at checkout.' },
  { id: 'dashboard.view', group: 'Sales', label: 'View the dashboard', description: 'Sales, stock, credit and purchasing figures at a glance.' },
  { id: 'catalog.view', group: 'Items', label: 'View items', description: 'Open Products and Categories.' },
  { id: 'catalog.manage', group: 'Items', label: 'Change products and categories', description: 'Add, edit, delete and restore products and categories.' },
  { id: 'inventory.manage', group: 'Items', label: 'Manage stock', description: 'Receive, adjust and repackage stock.' },
  { id: 'reports.view', group: 'Sales', label: 'View reports', description: 'The sales summary: sales, refunds, voids, what was taken by each payment method, and items sold.' },
  { id: 'purchasing.manage', group: 'Purchasing', label: 'Manage purchasing', description: 'Suppliers, purchase orders, receiving and paying suppliers.' },
  { id: 'settings.manage', group: 'Staff', label: 'Change shop settings', description: 'Settings that affect the whole till, such as whether the app keeps running when its window is closed, and which phones and tablets are paired with the till.' },
  { id: 'users.manage', group: 'Staff', label: 'Manage users', description: 'Add users, change what they may do, reset PINs and see sign-ins.' },
] as const satisfies readonly PermissionInfo[];

export type Permission = (typeof PERMISSIONS)[number]['id'];
export const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS.map((p) => p.id);

export const isPermission = (value: unknown): value is Permission => (ALL_PERMISSIONS as readonly unknown[]).includes(value);

/** Starting points for a new user: picking one fills in the switches, which can then be adjusted one by one. */
export const ROLE_PRESETS: Record<UserRole, readonly Permission[]> = {
  admin: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS.filter((p) => p !== 'users.manage' && p !== 'settings.manage'),
  cashier: ['checkout.sell', 'customers.view', 'customers.payments'],
};

export const ROLE_LABELS: Record<UserRole, string> = { admin: 'Admin', manager: 'Manager', cashier: 'Cashier' };

/** Permissions in the order of `PERMISSIONS`, without repeats or unknown values. */
export function normalizePermissions(values: readonly unknown[]): Permission[] {
  return ALL_PERMISSIONS.filter((p) => values.includes(p));
}

/** The preset whose permissions are exactly `permissions`, or null when they were customised. */
export function matchingRole(permissions: readonly Permission[]): UserRole | null {
  const set = new Set(permissions);
  return USER_ROLES.find((role) => ROLE_PRESETS[role].length === set.size && ROLE_PRESETS[role].every((p) => set.has(p))) ?? null;
}

/** The first page a user may open, or null when none of the pages is allowed (path by permission, in navigation order). */
export const PAGE_PERMISSIONS: readonly { path: string; permission: Permission }[] = [
  { path: '/dashboard', permission: 'dashboard.view' },
  { path: '/checkout', permission: 'checkout.sell' },
  { path: '/orders', permission: 'orders.view' },
  { path: '/customers', permission: 'customers.view' },
  { path: '/reports', permission: 'reports.view' },
  { path: '/purchases', permission: 'purchasing.manage' },
  { path: '/devices', permission: 'settings.manage' },
  { path: '/users', permission: 'users.manage' },
];

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
export const isValidPin = (pin: unknown): pin is string => typeof pin === 'string' && new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
export const PIN_RULE = `${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits`;

/** Wrong PINs in a row before sign-in is paused, and for how long. */
export const MAX_FAILED_SIGN_INS = 5;
export const SIGN_IN_PAUSE_MS = 60_000;

/** Who is signed in. */
export interface SessionUser {
  id: string;
  name: string;
  role: UserRole;
  permissions: Permission[];
  /** The PIN is one every installation starts with (or was reset by someone else): it must be changed before anything else. */
  pinChangeRequired: boolean;
}

/** What the sign-in screen lists: name only. */
export interface SignInChoice {
  id: string;
  name: string;
}

export type SignInResult = { ok: true; user: SessionUser } | { ok: false; error: string; pausedUntil?: number };

export interface ChangePinInput {
  currentPin: string;
  newPin: string;
}
export type ChangePinResult = { ok: true; user: SessionUser } | { ok: false; error: string };

/** A user as the Users page shows them. */
export interface UserRecord {
  id: string;
  name: string;
  /** Number printed on the staff badge or used in reports; unique among users. */
  employeeNumber: string;
  role: UserRole;
  permissions: Permission[];
  active: boolean;
  pinChangeRequired: boolean;
  lastSignInAt: number | null;
}

export interface UserInput {
  name: string;
  employeeNumber: string;
  role: UserRole;
  permissions: Permission[];
  active: boolean;
  /** Required when creating; ignored when updating (a PIN is reset with `users.resetPin`). */
  pin?: string;
}

export type UserField = 'name' | 'employeeNumber' | 'permissions' | 'active' | 'pin';
export type SaveUserResult = { ok: true; user: UserRecord } | { ok: false; field: UserField | null; error: string };
export type ResetPinResult = { ok: true } | { ok: false; error: string };

/** One sign-in, newest first on the Users page. */
export interface SignInLogEntry {
  id: string;
  userId: string;
  userName: string;
  signedInAt: number;
  /** Null while signed in, or when the app ended without signing out. */
  signedOutAt: number | null;
}

/** Checks the text fields of a user form. Permissions and PIN rules are checked by the caller that knows the context. */
export function validateUserInput(input: UserInput, creating: boolean): { field: UserField; error: string } | null {
  if (!input.name.trim()) return { field: 'name', error: 'Enter a name' };
  if (!input.employeeNumber.trim()) return { field: 'employeeNumber', error: 'Enter an employee number' };
  if (creating && !isValidPin(input.pin)) return { field: 'pin', error: `The PIN must be ${PIN_RULE}` };
  return null;
}
