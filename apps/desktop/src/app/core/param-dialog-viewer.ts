import { computed, DestroyRef, effect, inject, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { BrnDialogRef } from '@spartan-ng/brain/dialog';
import { filter } from 'rxjs';
import { AuthService } from './auth/auth.service';
import { BannerService } from './banner';

/**
 * A dialog that is open exactly while a query parameter names a record: `?view-sales-order=<id>`,
 * `?view-product=<id>`. It opens over whatever page is showing, removes its parameter when closed (replacing the
 * history entry, so Back does not reopen it), and several of them can be open at once, each with its own parameter.
 * Anything can link to a record by setting the parameter (`open(id)`, or a `routerLink` with `[queryParams]`), so
 * the address bar and the screen always agree. Subclasses are started once at launch (`App` injects them).
 *
 * Nothing is loaded or shown while nobody is signed in (the main process would refuse the call): an address restored at
 * launch with a dialog in it (the last page, `LastRoute`) opens as soon as someone has signed in.
 */
export abstract class ParamDialogViewer<T> {
  protected readonly router = inject(Router);
  protected readonly banner = inject(BannerService);
  private readonly auth = inject(AuthService);
  /** Someone is signed in and past choosing their own PIN: only then may a record be loaded. */
  private readonly unlocked = computed(() => {
    const user = this.auth.user();
    return !!user && !user.pinChangeRequired;
  });

  /** What the banner says when the id names nothing. */
  protected abstract readonly missingText: string;
  protected abstract load(id: string): Promise<T | null>;
  /** Opens the dialog for a loaded record. */
  protected abstract show(record: T): BrnDialogRef<unknown>;

  /** The record whose dialog is open (or being fetched). */
  private shown: string | null = null;
  private ref: BrnDialogRef<unknown> | null = null;

  constructor(private readonly param: string) {
    const subscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => void this.sync());
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
    effect(() => {
      this.unlocked();
      untracked(() => void this.sync()); // signing in opens the dialog the address already names
    });
  }

  /** Shows a record over the current page by setting the query parameter. */
  open(id: string): Promise<boolean> {
    return this.router.navigate([], { queryParams: { [this.param]: id }, queryParamsHandling: 'merge' });
  }

  private requested(): string | null {
    return this.router.parseUrl(this.router.url).queryParams[this.param] ?? null;
  }

  /** Makes the dialog match the address: open for a new id, closed when the parameter is gone. */
  private async sync(): Promise<void> {
    if (!this.unlocked()) return;
    const id = this.requested();
    if (id === this.shown) return;
    if (this.ref) {
      this.ref.close();
      this.ref = null;
    }
    this.shown = id;
    if (!id) return;

    const record = await this.load(id);
    if (this.shown !== id) return; // the address changed while the record was loading
    if (!record) {
      this.banner.error(this.missingText, { key: `${this.param}-missing` });
      this.shown = null;
      await this.clear();
      return;
    }
    const ref = this.show(record);
    this.ref = ref;
    ref.closed$.subscribe(() => {
      if (this.ref !== ref) return; // closed because the address moved on
      this.ref = null;
      this.shown = null;
      void this.clear();
    });
  }

  /** Takes the parameter out of the address. */
  private clear(): Promise<boolean> {
    return this.router.navigate([], { queryParams: { [this.param]: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
