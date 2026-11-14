import { inject, Service, signal } from '@angular/core';
import type { ResetPinResult, SaveUserResult, SignInLogEntry, UserInput, UserRecord } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import type { LoadStatus } from './catalog.service';

/** Users and the sign-in log over IPC (only people who may manage users can call these). */
@Service()
export class UsersService {
  private readonly api = inject(DESKTOP_API);

  readonly users = signal<UserRecord[]>([]);
  readonly signIns = signal<SignInLogEntry[]>([]);
  readonly status = signal<LoadStatus>('idle');

  async load(): Promise<void> {
    if (!this.api) {
      this.status.set('error');
      return;
    }
    this.status.set('loading');
    try {
      const [users, signIns] = await Promise.all([this.api.users.list(), this.api.users.signInLog()]);
      this.users.set(users);
      this.signIns.set(signIns);
      this.status.set('ready');
    } catch (error) {
      console.error('Failed to load users', error);
      this.status.set('error');
    }
  }

  /** Deactivates or reactivates a person: saves them as last saved with only `active` changed. The last person who can manage users, and yourself, are refused (`ok: false`). */
  setActive(user: UserRecord, active: boolean): Promise<SaveUserResult> {
    return this.save(user.id, { name: user.name, employeeNumber: user.employeeNumber, role: user.role, permissions: user.permissions, active });
  }

  /** Creates (no `id`) or updates a user and refreshes the lists. A rule violation comes back as `ok: false`. */
  async save(id: string | null, input: UserInput): Promise<SaveUserResult> {
    if (!this.api) return { ok: false, field: null, error: 'Not connected to the database' };
    let result: SaveUserResult;
    try {
      result = id ? await this.api.users.update(id, input) : await this.api.users.create(input);
    } catch (error) {
      console.error('Failed to save the user', error);
      return { ok: false, field: null, error: 'Could not save the user' };
    }
    if (result.ok) await this.load();
    return result;
  }

  async resetPin(id: string, pin: string): Promise<ResetPinResult> {
    if (!this.api) return { ok: false, error: 'Not connected to the database' };
    try {
      const result = await this.api.users.resetPin(id, pin);
      if (result.ok) await this.load();
      return result;
    } catch (error) {
      console.error('Failed to reset the PIN', error);
      return { ok: false, error: 'Could not reset the PIN' };
    }
  }
}
