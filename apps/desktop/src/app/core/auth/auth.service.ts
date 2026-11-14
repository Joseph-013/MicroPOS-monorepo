import { Dialog } from '@angular/cdk/dialog';
import { computed, inject, Service, signal } from '@angular/core';
import { ActivatedRouteSnapshot, Router } from '@angular/router';
import { ALL_PERMISSIONS, PAGE_PERMISSIONS, type ChangePinResult, type Permission, type SessionUser, type SignInChoice, type SignInResult } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { CheckoutDraftService } from '../data/checkout-draft.service';

/** Used where there is no main process to sign in to (the page opened in a plain browser): nothing is locked. */
const PREVIEW_USER: SessionUser = { id: 'preview', name: 'Preview', role: 'admin', permissions: [...ALL_PERMISSIONS], pinChangeRequired: false };

/**
 * Who is signed in. The main process holds the session and checks every call; this service lets the pages hide what
 * the person may not do, and drives the lock screen (nobody signed in: the till shows only the sign-in screen).
 */
@Service()
export class AuthService {
  private readonly api = inject(DESKTOP_API);
  private readonly dialogs = inject(Dialog);
  private readonly router = inject(Router);
  private readonly checkoutDraft = inject(CheckoutDraftService);

  readonly user = signal<SessionUser | null>(null);
  /** False until the main process has said whether someone is already signed in (a reloaded window keeps its session). */
  readonly ready = signal(false);
  readonly choices = signal<SignInChoice[]>([]);
  readonly signedIn = computed(() => this.user() !== null);

  private readonly started = this.start();

  /** Resolves once it is known whether someone is signed in. */
  whenReady(): Promise<void> {
    return this.started;
  }

  private async start(): Promise<void> {
    if (!this.api) {
      this.user.set(PREVIEW_USER);
      this.ready.set(true);
      return;
    }
    try {
      this.user.set(await this.api.auth.status());
      if (!this.user()) await this.loadChoices();
    } catch (error) {
      console.error('Failed to read who is signed in', error);
    }
    this.ready.set(true);
  }

  can(permission: Permission): boolean {
    return !!this.user()?.permissions.includes(permission);
  }

  async loadChoices(): Promise<void> {
    try {
      this.choices.set((await this.api?.auth.choices()) ?? []);
    } catch (error) {
      console.error('Failed to load the people who can sign in', error);
      this.choices.set([]);
    }
  }

  async signIn(userId: string, pin: string): Promise<SignInResult> {
    if (!this.api) return { ok: false, error: 'Not connected to the database' };
    let result: SignInResult;
    try {
      result = await this.api.auth.signIn({ userId, pin });
    } catch (error) {
      console.error('Failed to sign in', error);
      return { ok: false, error: 'Could not sign in' };
    }
    if (result.ok) {
      this.user.set(result.user);
      await this.router.navigateByUrl(this.allowedUrl(this.router.url), { replaceUrl: true }); // someone else's page may not be theirs to see
    }
    return result;
  }

  /** Locks the till: dialogs left open are closed (a half-filled form keeps its saved draft). */
  async signOut(): Promise<void> {
    // The order in progress is saved as this person's before the session ends (its debounced save would otherwise be
    // sent after the sign-out, and refused). Dialogs save their drafts as they close, before the sign-out is sent too.
    this.checkoutDraft.flush();
    this.dialogs.closeAll();
    try {
      await this.api?.auth.signOut();
    } catch (error) {
      console.error('Failed to sign out', error);
    }
    this.user.set(null);
    await this.loadChoices();
  }

  async changePin(currentPin: string, newPin: string): Promise<ChangePinResult> {
    if (!this.api) return { ok: false, error: 'Not connected to the database' };
    try {
      const result = await this.api.auth.changePin({ currentPin, newPin });
      if (result.ok) this.user.set(result.user);
      return result;
    } catch (error) {
      console.error('Failed to change the PIN', error);
      return { ok: false, error: 'Could not change the PIN' };
    }
  }

  /** Where `url` should go for this user: itself if they may open it, otherwise the first page they may open. */
  allowedUrl(url: string): string {
    const needed = this.permissionsFor(this.router.routerState.snapshot.root);
    return needed.every((p) => this.can(p)) ? url : this.homeUrl();
  }

  /** The first page the person may open (Settings, which is open to everyone, when none of the others is). */
  homeUrl(): string {
    return PAGE_PERMISSIONS.find((page) => this.can(page.permission))?.path ?? '/settings';
  }

  /** What the page now showing needs (collected from the route data down the tree). */
  private permissionsFor(route: ActivatedRouteSnapshot): Permission[] {
    const own = route.data['permission'] as Permission | undefined;
    return [...(own ? [own] : []), ...route.children.flatMap((child) => this.permissionsFor(child))];
  }
}
