import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMenu, lucideX } from '@ng-icons/lucide';
import { filter, map } from 'rxjs';
import { Logo } from './logo';
import { NavDrawer } from './nav-drawer';

/**
 * The bar across the top of the page: the name of the page being shown and, on a phone-sized screen, the logo and the
 * burger button at the far right that opens the navigation drawer (on wide screens the navigation is the rail on the
 * left and there is no burger).
 */
@Component({
  selector: 'app-topbar',
  imports: [NgIcon, Logo],
  providers: [provideIcons({ lucideMenu, lucideX })],
  host: { class: 'bg-background border-border sticky top-(--banner-offset,0px) z-10 block h-(--topbar-height) shrink-0 border-b' },
  template: `
    <header class="flex h-full items-center gap-3 px-3">
      @if (drawer.mobile()) {
        <app-logo class="shrink-0" />
      }
      <span class="min-w-0 flex-1 truncate text-lg" data-page-title>{{ title() }}</span>
      @if (drawer.mobile()) {
        <button
          type="button"
          class="hover:bg-accent -mr-2 flex size-10 shrink-0 items-center justify-center"
          aria-controls="main-nav"
          aria-label="Menu"
          [attr.aria-expanded]="drawer.open()"
          (click)="drawer.toggle()"
        >
          <ng-icon [name]="drawer.open() ? 'lucideX' : 'lucideMenu'" size="22" strokeWidth="1.5" />
        </button>
      }
    </header>
  `,
})
export class Topbar {
  protected readonly drawer = inject(NavDrawer);
  private readonly router = inject(Router);

  /** The title of the page being shown: the route's `title`, from the deepest route down. */
  protected readonly title = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.currentTitle()),
    ),
    { initialValue: this.currentTitle() },
  );

  private currentTitle(): string {
    let route = this.router.routerState.snapshot.root;
    let title = '';
    for (;;) {
      if (typeof route.routeConfig?.title === 'string') title = route.routeConfig.title;
      if (!route.firstChild) return title;
      route = route.firstChild;
    }
  }
}
