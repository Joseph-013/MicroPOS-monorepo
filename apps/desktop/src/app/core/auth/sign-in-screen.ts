import { Component, computed, DestroyRef, inject, signal, viewChild } from '@angular/core';
import { ROLE_LABELS, type SignInBranding, type SignInChoice } from '@micropos/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { DESKTOP_API } from '../api/desktop-api';
import { Logo } from '../logo';
import { AuthService } from './auth.service';
import { ChangePinForm } from './change-pin-form';
import { PinPad } from './pin-pad';

/** From this many people on, a name filter is shown above the tiles. */
export const SIGN_IN_FILTER_FROM = 13;

/** Lower case without accents, so "jose" finds "José". */
const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The lock screen: shown whenever nobody is signed in (and, after signing in with a starting PIN, until it is changed).
 * Covers everything, dialogs included. Shows the shop (its receipt logo and name, else the MicroPOS wordmark), the time,
 * and the people who can sign in; on a fresh install it also offers Restore from backup.
 */
@Component({
  selector: 'app-sign-in-screen',
  imports: [ChangePinForm, HlmButtonImports, HlmInputImports, Logo, PinPad],
  host: { class: 'bg-background fixed inset-0 z-[3000] flex flex-col items-center justify-center gap-6 overflow-y-auto p-6', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sign in' },
  template: `
    <header class="flex max-w-full flex-col items-center gap-2 text-center">
      @if (branding().logo; as logo) {
        <!-- Receipt logos are usually dark on transparent: a white plate keeps them visible in the dark theme. -->
        <span class="flex max-w-full items-center justify-center bg-white p-2">
          <img [src]="logo" alt="" class="max-h-20 max-w-60 object-contain" />
        </span>
      }
      @if (branding().shopName) {
        <p class="max-w-full truncate text-lg font-semibold select-text">{{ branding().shopName }}</p>
      } @else if (!branding().logo) {
        <app-logo />
      }
      <p class="text-4xl font-semibold tabular-nums" aria-live="off">{{ time() }}</p>
      <p class="text-muted-foreground text-sm">{{ date() }}</p>
    </header>

    @if (auth.user(); as user) {
      <!-- A starting PIN (a new account, or one reset by someone else) is replaced before anything else. -->
      <section class="flex w-80 max-w-full flex-col gap-4">
        <h1 class="truncate text-xl">Hello, {{ user.name }}</h1>
        <p class="text-muted-foreground text-sm">Choose your own PIN to continue.</p>
        <app-change-pin-form (changed)="picked.set(null)" />
        <button hlmBtn variant="outline" type="button" class="px-5" (click)="auth.signOut()">Cancel</button>
      </section>
    } @else if (picked(); as person) {
      <section class="flex max-w-full flex-col items-center gap-4">
        <span class="bg-primary/15 text-primary flex size-14 items-center justify-center text-xl font-semibold" aria-hidden="true">{{ initials(person.name) }}</span>
        <div class="flex max-w-80 flex-col items-center">
          <h1 class="max-w-full truncate text-xl">{{ person.name }}</h1>
          <p class="text-muted-foreground text-sm">{{ roleLabel(person) }}</p>
        </div>
        <app-pin-pad [error]="error()" [busy]="busy()" (typing)="error.set('')" (submitted)="submit(person, $event)" />
        <button hlmBtn variant="outline" type="button" class="px-5" (click)="back()">Someone else</button>
      </section>
    } @else {
      <section class="flex min-h-0 w-full max-w-3xl flex-col items-center gap-4">
        <h1 class="text-xl">Sign in as</h1>
        @if (!auth.ready()) {
          <p class="text-muted-foreground text-sm">Loading…</p>
        } @else if (auth.choices().length === 0) {
          <p class="text-muted-foreground text-sm">Nobody can sign in. Check the connection to the database.</p>
        } @else {
          @if (auth.choices().length >= filterFrom) {
            <input hlmInput type="search" class="w-72 max-w-full" placeholder="Search name" aria-label="Search name" [value]="query()" (input)="query.set($any($event.target).value)" />
          }
          <!-- Fixed-width tiles centred in rows, so one person or seven sit in the middle; a long list scrolls inside. -->
          <ul class="flex max-h-[50svh] w-full flex-wrap justify-center gap-3 overflow-y-auto p-1">
            @for (person of shown(); track person.id) {
              <li class="w-40 max-w-full">
                <button hlmBtn variant="outline" type="button" class="flex h-36 w-full flex-col gap-1 px-3" [attr.aria-label]="person.name" (click)="pick(person)">
                  <span class="bg-primary/15 text-primary mb-1 flex size-12 shrink-0 items-center justify-center text-lg font-semibold" aria-hidden="true">{{ initials(person.name) }}</span>
                  <span class="w-full min-w-0 truncate text-base">{{ person.name }}</span>
                  <span class="text-muted-foreground w-full min-w-0 truncate text-xs font-normal">{{ roleLabel(person) }}</span>
                </button>
              </li>
            } @empty {
              <li class="text-muted-foreground text-sm">Nobody matches "{{ query() }}"</li>
            }
          </ul>
        }
        @if (fresh()) {
          <div class="flex max-w-full flex-col items-center gap-1">
            <button hlmBtn variant="ghost" type="button" [disabled]="restoring()" (click)="restore()">{{ restoring() ? 'Restoring…' : 'Restore from backup' }}</button>
            @if (restoreError()) {
              <p class="text-destructive max-w-80 text-center text-sm select-text" role="alert">{{ restoreError() }}</p>
            }
          </div>
        }
      </section>
    }
  `,
})
export class SignInScreen {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(DESKTOP_API);
  private readonly pad = viewChild(PinPad);

  protected readonly filterFrom = SIGN_IN_FILTER_FROM;
  protected readonly picked = signal<SignInChoice | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly query = signal('');
  protected readonly branding = signal<SignInBranding>({ shopName: '', logo: null });
  /** A fresh install (nobody has signed in yet): Restore from backup is offered. */
  protected readonly fresh = signal(false);
  protected readonly restoring = signal(false);
  protected readonly restoreError = signal('');

  private readonly now = signal(Date.now());
  protected readonly time = computed(() => new Date(this.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  protected readonly date = computed(() => new Date(this.now()).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));

  protected readonly shown = computed(() => {
    const words = fold(this.query()).split(/\s+/).filter(Boolean);
    const people = this.auth.choices();
    return words.length ? people.filter((p) => words.every((w) => fold(p.name).includes(w))) : people;
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    void this.load();
  }

  /** "Store Owner" -> "SO", "Ana" -> "A": the first letters of the first two words. */
  protected initials(name: string): string {
    return name.trim().split(/\s+/).slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase() || '?';
  }

  protected roleLabel(person: SignInChoice): string {
    return ROLE_LABELS[person.role] ?? '';
  }

  protected pick(person: SignInChoice): void {
    this.picked.set(person);
    this.query.set('');
  }

  protected back(): void {
    this.picked.set(null);
    this.error.set('');
  }

  protected async submit(person: SignInChoice, pin: string): Promise<void> {
    this.busy.set(true);
    const result = await this.auth.signIn(person.id, pin);
    this.busy.set(false);
    if (result.ok) {
      this.picked.set(null);
      this.error.set('');
    } else {
      this.error.set(result.error);
      this.pad()?.clear();
    }
  }

  protected async restore(): Promise<void> {
    this.restoring.set(true);
    this.restoreError.set('');
    try {
      const result = await this.api!.backup.importFresh();
      // On success the app restarts with the restored data; until then the button keeps saying Restoring.
      if (!result.ok) {
        this.restoring.set(false);
        if (!result.canceled) this.restoreError.set(result.error);
      }
    } catch {
      this.restoring.set(false);
      this.restoreError.set('Could not restore the backup');
    }
  }

  /** Shop name and logo, and whether this is a fresh install. Neither is essential: the screen works without them. */
  private async load(): Promise<void> {
    try {
      const branding = await this.api?.auth.branding?.();
      if (branding) this.branding.set(branding);
    } catch {
      /* an older main process, or a phone: keep the wordmark */
    }
    try {
      this.fresh.set((await this.api?.backup?.freshInstall?.()) === true);
    } catch {
      /* a paired phone cannot restore the till's data */
    }
  }
}
