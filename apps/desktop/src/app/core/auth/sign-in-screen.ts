import { Component, inject, signal, viewChild } from '@angular/core';
import { type SignInChoice } from '@micropos/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { Logo } from '../logo';
import { AuthService } from './auth.service';
import { ChangePinForm } from './change-pin-form';
import { PinPad } from './pin-pad';

/**
 * The lock screen: shown whenever nobody is signed in (and, after signing in with a starting PIN, until it is changed).
 * Covers everything, dialogs included.
 */
@Component({
  selector: 'app-sign-in-screen',
  imports: [ChangePinForm, HlmButtonImports, Logo, PinPad],
  host: { class: 'bg-background fixed inset-0 z-[3000] flex flex-col items-center justify-center gap-6 overflow-y-auto p-6', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sign in' },
  template: `
    <app-logo />
    @if (auth.user(); as user) {
      <!-- A starting PIN (a new account, or one reset by someone else) is replaced before anything else. -->
      <section class="flex w-80 flex-col gap-4">
        <h1 class="text-xl">Hello, {{ user.name }}</h1>
        <p class="text-muted-foreground text-sm">Choose your own PIN to continue.</p>
        <app-change-pin-form (changed)="picked.set(null)" />
        <button hlmBtn variant="outline" type="button" class="px-5" (click)="auth.signOut()">Cancel</button>
      </section>
    } @else if (picked(); as person) {
      <section class="flex flex-col items-center gap-4">
        <h1 class="text-xl">{{ person.name }}</h1>
        <app-pin-pad [error]="error()" [busy]="busy()" (typing)="error.set('')" (submitted)="submit(person, $event)" />
        <button hlmBtn variant="outline" type="button" class="px-5" (click)="back()">Someone else</button>
      </section>
    } @else {
      <section class="flex w-full max-w-2xl flex-col items-center gap-4">
        <h1 class="text-xl">Who is signing in?</h1>
        @if (!auth.ready()) {
          <p class="text-muted-foreground text-sm">Loading…</p>
        } @else if (auth.choices().length === 0) {
          <p class="text-muted-foreground text-sm">Nobody can sign in. Check the connection to the database.</p>
        } @else {
          <ul class="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
            @for (person of auth.choices(); track person.id) {
              <li>
                <button hlmBtn variant="outline" type="button" class="h-20 w-full text-lg" (click)="picked.set(person)">{{ person.name }}</button>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class SignInScreen {
  protected readonly auth = inject(AuthService);
  private readonly pad = viewChild(PinPad);

  protected readonly picked = signal<SignInChoice | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);

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
}
