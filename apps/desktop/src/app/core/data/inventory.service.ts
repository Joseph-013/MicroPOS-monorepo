import { inject, Service, signal } from '@angular/core';
import type { ReturnToSupplierInput, ReturnToSupplierResult, AdjustStockInput, BatchRecord,  InventoryOverview, ReceiveStockInput, RepackageDraft, RepackageInput, RepackageResult, StockResult } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { refreshOnChange } from './refresh-on-change';
import type { LoadStatus } from './catalog.service';

/** Stock batches over IPC. Receiving and adjusting refresh the list so it always matches the ledger. */
@Service()
export class InventoryService {
  private readonly api = inject(DESKTOP_API);

  constructor() {
    refreshOnChange(['stock'], () => this.status() !== 'idle', () => this.load());
  }

  readonly batches = signal<BatchRecord[]>([]);
  readonly status = signal<LoadStatus>('idle');
  readonly overview = signal<InventoryOverview | null>(null);
  readonly overviewStatus = signal<LoadStatus>('idle');
  /** Also list batches that are used up. */
  readonly includeEmpty = signal(false);

  async setIncludeEmpty(value: boolean): Promise<void> {
    this.includeEmpty.set(value);
    await this.load();
  }

  async load(): Promise<void> {
    if (!this.api) {
      this.status.set('error');
      return;
    }
    this.status.set('loading');
    try {
      this.batches.set(await this.api.inventory.listBatches({ includeEmpty: this.includeEmpty() }));
      this.status.set('ready');
    } catch (error) {
      console.error('Failed to load stock', error);
      this.status.set('error');
    }
  }

  /** Loads the numbers for the overview page. */
  async loadOverview(): Promise<void> {
    if (!this.api) {
      this.overviewStatus.set('error');
      return;
    }
    this.overviewStatus.set('loading');
    try {
      this.overview.set(await this.api.inventory.overview());
      this.overviewStatus.set('ready');
    } catch (error) {
      console.error('Failed to load the inventory overview', error);
      this.overviewStatus.set('error');
    }
  }

  receive(input: ReceiveStockInput): Promise<StockResult> {
    return this.run(() => this.api!.inventory.receive(input), 'Could not receive the stock');
  }

  /** Sends stock back to a supplier, for a refund. Refreshes the batches like the other changes. */
  async returnToSupplier(input: ReturnToSupplierInput): Promise<ReturnToSupplierResult> {
    if (!this.api) return { ok: false, field: null, error: 'Not connected to the database' };
    let result: ReturnToSupplierResult;
    try {
      result = await this.api.inventory.returnToSupplier(input);
    } catch (error) {
      console.error('Could not return the stock', error);
      return { ok: false, field: null, error: 'Could not return the stock' };
    }
    if (result.ok) await this.load();
    return result;
  }

  adjust(input: AdjustStockInput): Promise<StockResult> {
    return this.run(() => this.api!.inventory.adjust(input), 'Could not change the stock');
  }

  /** Opens a pack: stock out of one product, into others. Refreshes the batches like the other changes. */
  async repackage(input: RepackageInput): Promise<RepackageResult> {
    if (!this.api) return { ok: false, field: null, error: 'Not connected to the database' };
    let result: RepackageResult;
    try {
      result = await this.api.inventory.repackage(input);
    } catch (error) {
      console.error('Could not repackage the stock', error);
      return { ok: false, field: null, error: 'Could not repackage the stock' };
    }
    if (result.ok) await this.load();
    return result;
  }

  /** The saved half-filled Repackage form, or null. */
  async loadRepackageDraft(): Promise<RepackageDraft | null> {
    try {
      return (await this.api?.inventory.loadRepackageDraft()) ?? null;
    } catch (error) {
      console.error('Failed to load the saved repackage form', error);
      return null;
    }
  }

  /** Saves the Repackage form shortly after the last change (debounced); `flushRepackageDraft` writes at once. */
  saveRepackageDraft(draft: RepackageDraft): void {
    this.pendingDraft = draft;
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.flushRepackageDraft(), 300);
  }

  flushRepackageDraft(): void {
    clearTimeout(this.draftTimer);
    if (this.pendingDraft) {
      this.api?.inventory.saveRepackageDraft(this.pendingDraft).catch((error: unknown) => console.error('Failed to save the repackage form', error));
    }
    this.pendingDraft = null;
  }

  clearRepackageDraft(): void {
    clearTimeout(this.draftTimer);
    this.pendingDraft = null;
    this.api?.inventory.clearRepackageDraft().catch((error: unknown) => console.error('Failed to clear the repackage draft', error));
  }

  private pendingDraft: RepackageDraft | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;

  private async run(call: () => Promise<StockResult>, failure: string): Promise<StockResult> {
    if (!this.api) return { ok: false, field: null, error: 'Not connected to the database' };
    let result: StockResult;
    try {
      result = await call();
    } catch (error) {
      console.error(failure, error);
      return { ok: false, field: null, error: failure };
    }
    if (result.ok) await this.load();
    return result;
  }
}
