import { DestroyRef, effect, inject, Service, signal } from '@angular/core';

/** Below this width (Tailwind's `md`) the navigation is a drawer from the right, opened by the burger button in the top bar. */
export const MOBILE_QUERY = '(max-width: 47.9375rem)';

/**
 * Whether the screen is a phone-sized one and, then, whether the navigation drawer is open. On wide screens the
 * navigation is the rail on the left as always and the drawer is never "open".
 */
@Service()
export class NavDrawer {
  private readonly query = window.matchMedia?.(MOBILE_QUERY);
  /** A narrow screen: the navigation moves to the right, hidden until the burger button is pressed. */
  readonly mobile = signal(this.query?.matches ?? false);
  readonly open = signal(false);

  constructor() {
    const onChange = (event: MediaQueryListEvent): void => this.mobile.set(event.matches);
    this.query?.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.query?.removeEventListener('change', onChange));
    // Growing the window past the breakpoint leaves no drawer open behind.
    effect(() => {
      if (!this.mobile()) this.open.set(false);
    });
  }

  toggle(): void {
    if (this.mobile()) this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }
}
