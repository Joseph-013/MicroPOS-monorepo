import { DestroyRef, Directive, ElementRef, inject, input, output } from '@angular/core';

/**
 * Press and hold to repeat. A normal tap still fires the element's own `(click)`. If the press is held past
 * `holdDelay`, `(held)` fires and keeps firing, faster the longer it is held, until release; the click that
 * follows such a hold is swallowed so the action is not run one extra time.
 *
 *   <button appHoldRepeat (click)="step(1)" (held)="step(1)">+</button>
 */
@Directive({
  selector: '[appHoldRepeat]',
  host: {
    '(pointerdown)': 'start($event)',
    '(pointerup)': 'stop()',
    '(pointerleave)': 'stop()',
    '(pointercancel)': 'stop()',
    // A long touch press can raise the context menu; it would interrupt the hold.
    '(contextmenu)': '$event.preventDefault()',
  },
})
export class HoldRepeatDirective {
  /** Fires on every repeat while held. */
  readonly held = output<void>();
  /** Milliseconds to hold before repeating starts. */
  readonly holdDelay = input(400);

  private timer: ReturnType<typeof setTimeout> | undefined;
  private repeats = 0;
  private swallowClick = false;

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    // Capture phase on the element itself runs before its own (click) handlers.
    const onClick = (event: Event): void => {
      if (!this.swallowClick) return;
      this.swallowClick = false;
      event.stopImmediatePropagation();
      event.preventDefault();
    };
    element.addEventListener('click', onClick, true);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      element.removeEventListener('click', onClick, true);
    });
  }

  protected start(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.stop();
    this.repeats = 0;
    this.swallowClick = false;
    this.timer = setTimeout(() => this.tick(), this.holdDelay());
  }

  protected stop(): void {
    clearTimeout(this.timer);
  }

  private tick(): void {
    this.repeats++;
    this.swallowClick = true;
    this.held.emit();
    // 160 ms between repeats at first, speeding up to 40 ms.
    this.timer = setTimeout(() => this.tick(), Math.max(40, 160 - this.repeats * 12));
  }
}
