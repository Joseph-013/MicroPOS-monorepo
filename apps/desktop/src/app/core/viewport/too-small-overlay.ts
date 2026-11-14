import { Component, computed, DestroyRef, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { isLanDevice } from '../api/remote-api';
import { isPopoverOpen, keepOnTop } from './top-layer';

/** Smallest window the layouts are designed for (CSS pixels). */
export const MIN_WINDOW = { width: 1024, height: 400 } as const;

/**
 * Full-window warning that covers the app while the window is smaller than `MIN_WINDOW`.
 *
 * It is a manual popover so it lives in the browser's top layer, like the CDK overlays that
 * dialogs and menus use. `z-index` cannot beat the top layer, so it is re-raised whenever
 * another popover opens (see `keepOnTop`). Priority 2: it stays above the banner too.
 */
@Component({
  selector: 'app-too-small-overlay',
  template: `
    <div
      #panel
      popover="manual"
      data-top-layer-priority="2"
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
  /** A phone or tablet paired over the network is small by nature: it gets the app as it is, to scroll, with no warning. */
  private readonly onLanDevice = isLanDevice();
  protected readonly tooSmall = computed(
    () => !this.onLanDevice && (this.size().width < MIN_WINDOW.width || this.size().height < MIN_WINDOW.height),
  );
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  constructor() {
    const onResize = (): void => this.size.set(this.measure());
    window.addEventListener('resize', onResize);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('resize', onResize));
    keepOnTop(() => this.panel().nativeElement, 2, () => this.tooSmall());

    effect(() => {
      const panel = this.panel().nativeElement;
      if (this.tooSmall()) {
        if (!isPopoverOpen(panel)) panel.showPopover?.();
      } else if (isPopoverOpen(panel)) {
        panel.hidePopover?.();
      }
    });
  }

  private measure(): { width: number; height: number } {
    return { width: window.innerWidth, height: window.innerHeight };
  }
}
