import { effect, inject, Service, signal } from '@angular/core';
import { AuthService } from './auth/auth.service';
import { StorageService } from './storage/storage.service';

export type ThemeMode = 'light' | 'dark' | 'system';
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];
export const THEME_LABELS: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' };

const isThemeMode = (v: unknown): v is ThemeMode => v === 'light' || v === 'dark' || v === 'system';

/**
 * Light, dark or follow the system. A per-user preference: each person's choice is remembered on this device under
 * their id and applied when they sign in. The lock screen (nobody signed in) and anyone who has not chosen yet use
 * the last choice made on the device.
 */
@Service()
export class ThemeService {
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);
  private readonly _mode = signal<ThemeMode>(this.storage.get<ThemeMode>('theme', 'system', isThemeMode));
  readonly mode = this._mode.asReadonly();
  private readonly media = window.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);

  constructor() {
    this.media?.addEventListener('change', (e) => this.systemDark.set(e.matches));
    effect(() => {
      const mode = this._mode();
      const dark = mode === 'dark' || (mode === 'system' && this.systemDark());
      document.documentElement.classList.toggle('dark', dark);
    });
    // Whoever signs in gets their own choice, if they have made one.
    effect(() => {
      const id = this.auth.user()?.id;
      if (id) this._mode.set(this.storage.get<ThemeMode>(`theme.${id}`, this._mode(), isThemeMode));
    });
  }

  /** Changes the theme for the signed-in person, and is what the lock screen starts from next time. */
  set(mode: ThemeMode): void {
    this._mode.set(mode);
    this.storage.set('theme', mode);
    const id = this.auth.user()?.id;
    if (id) this.storage.set(`theme.${id}`, mode);
  }
}
