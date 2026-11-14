import { inject, Service, signal } from '@angular/core';
import type { CashDrawerState, CashMovementInput, CashResult, CashSessionRecord, CloseDrawerInput } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import type { LoadStatus } from './catalog.service';

const NOT_CONNECTED = { ok: false, field: null, error: 'Not connected to the database' } as const;

/** The cash drawer over IPC: whether it is open, what went in and out by hand, and closing it with a count. */
@Service()
export class CashService {
  private readonly api = inject(DESKTOP_API);

  readonly state = signal<CashDrawerState>({ session: null, movements: [], lastClosed: null });
  readonly status = signal<LoadStatus>('idle');

  async load(): Promise<void> {
    if (!this.api) return void this.status.set('error');
    this.status.set('loading');
    try {
      this.state.set(await this.api.cash.state());
      this.status.set('ready');
    } catch (error) {
      console.error('Failed to load the cash drawer', error);
      this.status.set('error');
    }
  }

  private async change<T>(call: () => Promise<CashResult<T>>, failure: string, apply: (value: T) => void): Promise<CashResult<T>> {
    if (!this.api) return NOT_CONNECTED;
    let result: CashResult<T>;
    try {
      result = await call();
    } catch (error) {
      console.error(failure, error);
      return { ok: false, field: null, error: failure };
    }
    if (result.ok) apply(result.value);
    return result;
  }

  open(openingFloat: number): Promise<CashResult<CashDrawerState>> {
    return this.change(() => this.api!.cash.open({ openingFloat }), 'Could not open the drawer', (state) => this.state.set(state));
  }

  addMovement(input: CashMovementInput): Promise<CashResult<CashDrawerState>> {
    return this.change(() => this.api!.cash.addMovement(input), 'Could not record the cash', (state) => this.state.set(state));
  }

  /** Closes the drawer; the page then shows how the count compared (`state().lastClosed`). */
  async close(input: CloseDrawerInput): Promise<CashResult<CashSessionRecord>> {
    const result = await this.change(() => this.api!.cash.close(input), 'Could not close the drawer', () => undefined);
    if (result.ok) await this.load();
    return result;
  }
}
