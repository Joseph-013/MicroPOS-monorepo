import { DATA_DOMAINS, type DataDomain } from '@micropos/core';
import { CHANNELS } from './channels';

/**
 * Which parts of the data a channel changes when it succeeds. After it runs, the renderer is told (`data:changed`),
 * so anything that depends on those parts (the nav rail badges and the concerns dialogs) refreshes itself without
 * every writer having to remember it. A write that belongs in none of these is listed in `UNRELATED` instead; a
 * test fails for a channel that is in neither, so a new write path cannot be forgotten.
 */
export const WRITES: Readonly<Record<string, readonly DataDomain[]>> = {
  [CHANNELS.products.create]: ['stock'],
  [CHANNELS.products.update]: ['stock'],
  [CHANNELS.products.remove]: ['stock'],
  [CHANNELS.products.restore]: ['stock'],
  [CHANNELS.products.setActive]: ['stock'],
  [CHANNELS.inventory.receive]: ['stock'],
  [CHANNELS.inventory.adjust]: ['stock'],
  [CHANNELS.inventory.repackage]: ['stock'],
  [CHANNELS.inventory.returnToSupplier]: ['stock', 'purchases'],
  [CHANNELS.purchases.create]: ['purchases'],
  [CHANNELS.purchases.update]: ['purchases'],
  [CHANNELS.purchases.receive]: ['purchases', 'stock'],
  [CHANNELS.purchases.pay]: ['purchases'],
  [CHANNELS.purchases.cancel]: ['purchases'],
  [CHANNELS.customers.create]: ['customers'],
  [CHANNELS.customers.update]: ['customers'],
  [CHANNELS.customers.remove]: ['customers'],
  [CHANNELS.customers.restore]: ['customers'],
  [CHANNELS.customers.receivePayment]: ['customers'],
  [CHANNELS.customers.saveAlertSettings]: ['customers'],
  [CHANNELS.orders.void]: ['customers', 'stock'],
  [CHANNELS.orders.refund]: ['customers', 'stock'],
  [CHANNELS.checkout.completeOrder]: ['customers', 'stock'],
};

/** Every other channel: reads, drafts, sign-in and settings that no badge depends on. */
export const UNRELATED: readonly string[] = [
  CHANNELS.app.version,
  CHANNELS.catalog.listProducts,
  CHANNELS.catalog.listCategories,
  CHANNELS.products.list,
  CHANNELS.products.loadDraft,
  CHANNELS.products.saveDraft,
  CHANNELS.products.clearDraft,
  CHANNELS.categories.list,
  CHANNELS.categories.create,
  CHANNELS.categories.update,
  CHANNELS.categories.remove,
  CHANNELS.categories.restore,
  CHANNELS.inventory.listBatches,
  CHANNELS.inventory.overview,
  CHANNELS.inventory.concerns,
  CHANNELS.inventory.loadRepackageDraft,
  CHANNELS.inventory.saveRepackageDraft,
  CHANNELS.inventory.clearRepackageDraft,
  CHANNELS.display.show,
  CHANNELS.display.hide,
  CHANNELS.display.isOpen,
  CHANNELS.display.publish,
  CHANNELS.display.getState,
  CHANNELS.display.state,
  CHANNELS.display.visibility,
  CHANNELS.scanner.scan,
  CHANNELS.scanner.setEnabled,
  CHANNELS.suppliers.list,
  CHANNELS.suppliers.create,
  CHANNELS.suppliers.update,
  CHANNELS.suppliers.remove,
  CHANNELS.suppliers.restore,
  CHANNELS.purchases.concerns,
  CHANNELS.purchases.list,
  CHANNELS.purchases.get,
  CHANNELS.customers.list,
  CHANNELS.customers.account,
  CHANNELS.customers.interestDefaults,
  CHANNELS.customers.saveInterestDefaults,
  CHANNELS.customers.alertCount,
  CHANNELS.customers.alertSettings,
  CHANNELS.orders.list,
  CHANNELS.orders.get,
  CHANNELS.auth.status,
  CHANNELS.auth.choices,
  CHANNELS.auth.signIn,
  CHANNELS.auth.signOut,
  CHANNELS.auth.changePin,
  CHANNELS.users.list,
  CHANNELS.users.create,
  CHANNELS.users.update,
  CHANNELS.users.resetPin,
  CHANNELS.users.signInLog,
  CHANNELS.checkout.loadDraft,
  CHANNELS.checkout.saveDraft,
  CHANNELS.checkout.clearDraft,
  CHANNELS.checkout.nextOrderNumber,
  CHANNELS.shell.getCloseToTray,
  CHANNELS.shell.setCloseToTray,
  CHANNELS.data.changed,
];

type Listener = (domains: readonly DataDomain[]) => void;
const listeners = new Set<Listener>();

/** Listens in the main process (the concerns clock reschedules itself when data changes). Returns a function that stops. */
export function onDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Announces that these parts of the data changed (to the main process listeners, and through them to every window). */
export function emitDataChanged(domains: readonly DataDomain[] = DATA_DOMAINS): void {
  for (const listener of [...listeners]) listener(domains);
}

/** Whether a handler's result says nothing was written (a refused save is `{ ok: false }`). */
export const wroteNothing = (result: unknown): boolean => typeof result === 'object' && result !== null && 'ok' in result && (result as { ok: unknown }).ok === false;
