import { effect, inject, Service, signal } from '@angular/core';
import { StorageService } from './storage/storage.service';

export type ThemeMode = 'light' | 'dark' | 'system';

const isThemeMode = (v: unknown): v is ThemeMode => v === 'light' || v === 'dark' || v === 'system';

@Service()
export class ThemeService {
  private readonly storage = inject(StorageService);
  readonly mode = signal<ThemeMode>(this.storage.get<ThemeMode>('theme', 'system', isThemeMode));
  private readonly media = window.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);

  constructor() {
    this.media?.addEventListener('change', (e) => this.systemDark.set(e.matches));
    effect(() => {
      const mode = this.mode();
      const dark = mode === 'dark' || (mode === 'system' && this.systemDark());
      document.documentElement.classList.toggle('dark', dark);
      this.storage.set('theme', mode);
    });
  }
}
