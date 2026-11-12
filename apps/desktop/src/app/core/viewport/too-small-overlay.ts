import { Component, computed, DestroyRef, effect, ElementRef, inject, signal, viewChild } from '@angular/core';

/** Smallest window the layouts are designed for (CSS pixels). */
export const MIN_WINDOW = { width: 1024, height: 600 } as const;

/**
 * Full-window warning that covers the app while the window is smaller than `MIN_WINDOW`.
 *
 * It is a manual popover so it lives in the browser's top layer, like the CDK overlays that
 * dialogs and menus use. `z-index` cannot beat the top layer, so it is re-raised whenever
 * another popover opens, which keeps it above them.
 */
@Component({
  selector: 'app-too-small-overlay',
  template: `
    <div
      #panel
      popover="manual"
      class="bg-background/95 fixed inset-0 m-0 h-full w-full max-w-none items-center justify-center border-0 p-4 backdrop-blur-sm [&:popover-open]:flex"
    >
      @if (tooSmall()) {
        <div role="alert" class="blueprint bg-popover flex max-w-sm flex-col gap-2 p-6 text-center">
          <h2 class="text-xl">Window too small</h2>
          <p class="text-sm">Enlarge the window to at least {{ min.width }} × {{ min.height }}.</p>
          <p class="text-muted-foreground text-sm">Now {{ size().width }} × {{ size().height }}</p>
        </div>
      }
    </div>
  `,
})
export class TooSmallOverlay {
  protected readonly min = MIN_WINDOW;
  protected readonly size = signal(this.measure());
  protected readonly tooSmall = computed(
    () => this.size().width < MIN_WINDOW.width || this.size().height < MIN_WINDOW.height,
  );
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  constructor() {
    const onResize = (): void => this.size.set(this.measure());
    // Any other popover opening (dialog, menu...) would land above us; move back to the top.
    const onToggle = (event: Event): void => {
      const panel = this.panel().nativeElement;
      if (event.target !== panel && (event as ToggleEvent).newState === 'open' && this.tooSmall()) this.raise();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('toggle', onToggle, true);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('toggle', onToggle, true);
    });

    effect(() => {
      const panel = this.panel().nativeElement;
      if (this.tooSmall()) {
        if (!this.isOpen(panel)) panel.showPopover?.();
      } else if (this.isOpen(panel)) {
        panel.hidePopover?.();
      }
    });
  }

  private raise(): void {
    const panel = this.panel().nativeElement;
    panel.hidePopover?.();
    panel.showPopover?.();
  }

  private isOpen(panel: HTMLElement): boolean {
    try {
      return panel.matches(':popover-open');
    } catch {
      return false; // no Popover API (e.g. jsdom)
    }
  }

  private measure(): { width: number; height: number } {
    return { width: window.innerWidth, height: window.innerHeight };
  }
}
