import { DestroyRef, inject, Service } from '@angular/core';
import { NavigationEnd, NavigationError, Router, UrlTree } from '@angular/router';
import { StorageService } from './storage/storage.service';

const KEY = 'lastUrl';
const isString = (value: unknown): value is string => typeof value === 'string';

/**
 * Remembers the last page shown, query parameters included (so an open dialog such as a half-filled form is
 * reopened, its draft with it), and brings the app back to it when it starts. Only the till's window uses it: the
 * customer display is never saved.
 */
@Service()
export class LastRoute {
  private readonly router = inject(Router);
  private readonly storage = inject(StorageService);
  private readonly destroyRef = inject(DestroyRef);

  /** Where the app opens: the saved page if it still exists, otherwise `fallback`. */
  startUrl(fallback: string): UrlTree {
    const saved = this.storage.get(KEY, '', isString);
    return this.router.parseUrl(this.isRestorable(saved) ? saved : fallback);
  }

  /** Starts saving every page the till's window shows. */
  track(): void {
    const subscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd && this.isRestorable(event.urlAfterRedirects)) this.storage.set(KEY, event.urlAfterRedirects);
      // The saved page can be stale (a route removed or renamed by an update): forget it and open Checkout instead of a blank page.
      else if (event instanceof NavigationError && event.url === this.storage.get(KEY, '', isString)) {
        this.storage.remove(KEY);
        void this.router.navigateByUrl('/checkout', { replaceUrl: true });
      }
    });
    this.destroyRef.onDestroy(() => subscription.unsubscribe());
  }

  /** A route of this build that is not the customer display (a developer-only page saved by a development build is dropped in production). */
  private isRestorable(url: string): boolean {
    if (!url.startsWith('/')) return false;
    let tree: UrlTree;
    try {
      tree = this.router.parseUrl(url);
    } catch {
      return false;
    }
    const first = tree.root.children['primary']?.segments[0]?.path;
    return !!first && first !== 'customer-display' && this.router.config.some((route) => route.path === first);
  }
}
