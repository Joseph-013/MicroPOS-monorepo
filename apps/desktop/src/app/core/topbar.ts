import { Component, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMenu, lucideX } from '@ng-icons/lucide';
import { Logo } from './logo';
import { NavDrawer } from './nav-drawer';

/**
 * The bar across the top of the page on a phone-sized screen only: the logo on the left and the burger button at the far
 * right that opens the navigation drawer. Wide screens have no top bar (the navigation is the rail on the left). It has no
 * page title: every page already shows its own.
 */
@Component({
  selector: 'app-topbar',
  imports: [NgIcon, Logo],
  providers: [provideIcons({ lucideMenu, lucideX })],
  host: { class: 'bg-background border-border sticky top-(--banner-offset,0px) z-10 hidden h-(--topbar-height) shrink-0 border-b max-md:block' },
  template: `
    <header class="flex h-full items-center justify-between gap-3 px-3">
      <app-logo class="shrink-0" />
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
}
