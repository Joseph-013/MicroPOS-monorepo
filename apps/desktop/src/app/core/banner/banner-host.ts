import { Component, effect, ElementRef, inject, viewChild } from '@angular/core';
import { isPopoverOpen, keepOnTop } from '../viewport/top-layer';
import { BannerService } from './banner.service';

/**
 * Renders the current banner as a thin strip across the top of the window. Place once at the root.
 * It is a manual popover (top layer) so it appears above open dialogs; priority 1, below the
 * "window too small" overlay. Hovering the strip pauses a timed banner's countdown. Click the strip to dismiss it (a banner with an action shows its button right beside the message).
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
        <div
          class="animate-in fade-in-0 slide-in-from-top-2 pointer-events-auto flex h-9 w-full items-center justify-center duration-150 {{ severityClass(message.severity) }}"
          (mouseenter)="banner.pause()"
          (mouseleave)="banner.resume()"
          (click)="message.dismissible && banner.dismiss()"
        >
          <button
            type="button"
            class="flex h-9 min-w-0 items-center justify-center truncate pl-4 {{ message.action ? 'pr-1' : 'pr-4' }} text-center text-sm font-medium {{ message.action ? '' : 'flex-1' }} {{ severityClass(message.severity) }}"
            [attr.role]="message.severity === 'error' || message.severity === 'warning' ? 'alert' : 'status'"
            [attr.data-severity]="message.severity"
          >
            {{ message.text }}
          </button>
          @if (message.action; as action) {
            <!-- Right beside the message, not at the edge of the window. -->
            <button
              type="button"
              class="h-9 shrink-0 px-2 text-sm font-semibold underline underline-offset-4 hover:no-underline {{ severityClass(message.severity) }}"
              (click)="$event.stopPropagation(); banner.dismiss(); action.run()"
            >
              {{ action.label }}
            </button>
          }
        </div>
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
