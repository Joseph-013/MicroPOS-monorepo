import { Component, effect, ElementRef, inject, viewChild } from '@angular/core';
import { isPopoverOpen, keepOnTop } from '../viewport/top-layer';
import { BannerService } from './banner.service';

/**
 * Renders the current banner as a thin strip across the top of the window. Place once at the root.
 * It is a manual popover (top layer) so it appears above open dialogs; priority 1, below the
 * "window too small" overlay. Click the strip to dismiss it.
 */
@Component({
  selector: 'app-banner-host',
  template: `
    <div
      #panel
      popover="manual"
      data-top-layer-priority="1"
      class="pointer-events-none fixed inset-x-0 top-0 m-0 h-auto w-full max-w-none overflow-visible border-0 bg-transparent p-0"
    >
      @if (banner.current(); as message) {
        <button
          type="button"
          class="animate-in fade-in-0 slide-in-from-top-2 pointer-events-auto flex h-9 w-full items-center justify-center truncate px-4 text-center text-sm font-medium duration-150 {{ severityClass(message.severity) }}"
          [attr.role]="message.severity === 'error' || message.severity === 'warning' ? 'alert' : 'status'"
          [attr.data-severity]="message.severity"
          (click)="message.dismissible && banner.dismiss()"
        >
          {{ message.text }}
        </button>
      }
    </div>
  `,
})
export class BannerHost {
  protected readonly banner = inject(BannerService);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  constructor() {
    keepOnTop(() => this.panel().nativeElement, 1, () => !!this.banner.current());

    effect(() => {
      const panel = this.panel().nativeElement;
      if (this.banner.current()) {
        if (!isPopoverOpen(panel)) panel.showPopover?.();
      } else if (isPopoverOpen(panel)) {
        panel.hidePopover?.();
      }
    });
  }

  protected severityClass(severity: string): string {
    switch (severity) {
      case 'success':
        return 'bg-success text-success-foreground';
      case 'warning':
        return 'bg-warning text-warning-foreground';
      case 'error':
        return 'bg-destructive text-destructive-foreground';
      default:
        return 'bg-primary text-primary-foreground';
    }
  }
}
