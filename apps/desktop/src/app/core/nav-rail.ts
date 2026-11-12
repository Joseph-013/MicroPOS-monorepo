import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideChevronRight,
  lucideComputer,
  lucideLayoutGrid,
  lucideLogOut,
  lucideMonitor,
  lucideMoon,
  lucidePackage,
  lucidePin,
  lucidePinOff,
  lucideReceipt,
  lucideSettings,
  lucideShoppingCart,
  lucideSun,
} from '@ng-icons/lucide';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Logo } from './logo';
import { StorageService } from './storage/storage.service';
import { ThemeMode, ThemeService } from './theme.service';

/** A nav entry: either a link (`path`) or a group (`children`), nestable to any depth. */
export interface NavItem {
  id: string;
  label: string;
  icon?: string;
  path?: string;
  children?: NavItem[];
}

/**
 * Left navigation rail. Collapsed to icons by default; expands over the content
 * on hover/focus, and stays expanded (pushing the content) when pinned.
 */
@Component({
  selector: 'app-nav-rail',
  imports: [NgIcon, NgTemplateOutlet, RouterLink, RouterLinkActive, Logo],
  providers: [
    provideIcons({
      lucideChevronRight,
      lucideComputer,
      lucideShoppingCart,
      lucidePackage,
      lucideReceipt,
      lucideSettings,
      lucideLogOut,
      lucideLayoutGrid,
      lucideSun,
      lucideMoon,
      lucideMonitor,
      lucidePin,
      lucidePinOff,
    }),
  ],
  templateUrl: './nav-rail.html',
  host: { class: 'block shrink-0 transition-[width] duration-200 ease-out' , '[style.width]': 'pinned() ? "16rem" : "3.5rem"' },
})
export class NavRail {
  protected readonly theme = inject(ThemeService);
  private readonly storage = inject(StorageService);

  protected readonly pinned = signal(this.storage.get('navPinned', false, (v): v is boolean => typeof v === 'boolean'));
  private readonly hovered = signal(false);
  protected readonly expanded = computed(() => this.pinned() || this.hovered());

  protected readonly nav: NavItem[] = [
    { id: 'checkout', path: '/checkout', label: 'Checkout', icon: 'lucideShoppingCart' },
    {
      id: 'items',
      label: 'Items',
      icon: 'lucidePackage',
      children: [
        { id: 'items-products', path: '/items/products', label: 'Products' },
        { id: 'items-categories', path: '/items/categories', label: 'Categories' },
      ],
    },
    { id: 'orders', path: '/orders', label: 'Sales Orders', icon: 'lucideReceipt' },
    { id: 'components', path: '/components', label: 'Components', icon: 'lucideLayoutGrid' },
  ];

  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly openGroups = signal<ReadonlySet<string>>(new Set());

  constructor() {
    this.openActiveGroups();
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.openActiveGroups());
  }

  /** Keep the groups containing the current page open. */
  private openActiveGroups(): void {
    const next = new Set(this.openGroups());
    const visit = (items: NavItem[], trail: string[]): void => {
      for (const item of items) {
        if (item.children) visit(item.children, [...trail, item.id]);
        else if (item.path && this.isLinkActive(item.path)) trail.forEach((id) => next.add(id));
      }
    };
    visit(this.nav, []);
    this.openGroups.set(next);
  }

  protected isOpen(item: NavItem): boolean {
    return this.openGroups().has(item.id);
  }

  protected toggleGroup(item: NavItem): void {
    this.openGroups.update((set) => {
      const next = new Set(set);
      if (!next.delete(item.id)) next.add(item.id);
      return next;
    });
  }

  /** True when the item, or any descendant, is the current page. */
  protected hasActive(item: NavItem): boolean {
    this.url();
    if (item.children) return item.children.some((c) => this.hasActive(c));
    return !!item.path && this.isLinkActive(item.path);
  }

  private isLinkActive(path: string): boolean {
    return this.router.isActive(path, {
      paths: 'subset',
      queryParams: 'ignored',
      fragment: 'ignored',
      matrixParams: 'ignored',
    });
  }

  /** Left padding: leaf rows align under their parent's label, deeper levels indent further. */
  protected indent(level: number): number {
    return level === 0 ? 11 : 41 + (level - 1) * 12;
  }

  private readonly modes: { id: ThemeMode; label: string; icon: string }[] = [
    { id: 'light', label: 'Light', icon: 'lucideSun' },
    { id: 'dark', label: 'Dark', icon: 'lucideMoon' },
    { id: 'system', label: 'System', icon: 'lucideMonitor' },
  ];

  protected readonly currentMode = computed(
    () => this.modes.find((m) => m.id === this.theme.mode()) ?? this.modes[2],
  );

  protected setHovered(value: boolean): void {
    this.hovered.set(value);
  }

  protected onFocusOut(event: FocusEvent, rail: HTMLElement): void {
    if (!rail.contains(event.relatedTarget as Node | null)) this.hovered.set(false);
  }

  protected togglePin(): void {
    this.pinned.update((v) => !v);
    this.storage.set('navPinned', this.pinned());
  }

  protected cycleTheme(): void {
    const i = this.modes.findIndex((m) => m.id === this.theme.mode());
    this.theme.mode.set(this.modes[(i + 1) % this.modes.length].id);
  }
}
