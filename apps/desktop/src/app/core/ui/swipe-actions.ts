import { Component, computed, DestroyRef, ElementRef, inject, input, output, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

/** Horizontal distance (px) before a drag counts as a swipe rather than a tap or a vertical scroll. */
const DECIDE_AFTER_PX = 8;
const ANIMATION_MS = 150;

export type SwipeTone = 'primary' | 'success' | 'warning' | 'destructive' | 'neutral';

export interface SwipeAction {
  id: string;
  label: string;
  /** An `ng-icon` name; the consumer must provide it with `provideIcons`. */
  icon?: string;
  tone?: SwipeTone;
  /** Slide the row out of view before the action runs (for removal). Otherwise the row springs back. */
  exit?: boolean;
}

export interface SwipeActionEvent {
  action: SwipeAction;
  /** Which way the row was swiped. */
  side: 'left' | 'right';
}

const TONE_CLASS: Record<SwipeTone, string> = {
  primary: 'bg-primary text-primary-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  destructive: 'bg-destructive text-white',
  neutral: 'bg-secondary text-secondary-foreground',
};

/**
 * A row that can be swiped left and/or right (touch and pen) to run actions.
 *
 * Each direction takes a list of actions, ordered by how far you have to drag: the first is nearest the edge
 * you are revealing and is reached first. Drag past `distance` to highlight the first, one more `step` to
 * highlight the second, and so on (the last stays highlighted if you keep going). Release while an action is
 * highlighted to run it; release before `distance` and the row springs back.
 *
 *   <app-swipe-actions [swipeLeft]="[remove]" [swipeRight]="[edit, flag]" (action)="run($event)">
 *     ...row content...
 *   </app-swipe-actions>
 *
 * Swiping is for touch. Mouse and keyboard users need another route to the same actions (a context menu,
 * buttons). Vertical drags are left alone so lists still scroll.
 */
@Component({
  selector: 'app-swipe-actions',
  imports: [NgIcon],
  // A one-cell grid stacks the revealed actions with the row. `overflow-clip` (not hidden) keeps the host from
  // becoming a scroll container, so the actions can stick to the visible edge of a wider, scrolling parent.
  host: { class: 'relative grid grid-cols-[minmax(0,1fr)] overflow-clip' },
  template: `
    @if (side(); as side) {
      <!-- Revealed at the edge the row is sliding away from. Sticky, so when the row is wider than the visible area
           (a horizontally scrolling table) the actions stay at the edge you can see, not at the far end of the row. -->
      <div
        class="sticky z-10 col-start-1 row-start-1 flex overflow-hidden {{ side === 'left' ? 'right-0 flex-row-reverse justify-self-end' : 'left-0 justify-self-start' }} {{ highlightedClass() }}"
        [style.width.px]="revealed()"
        aria-hidden="true"
      >
        @for (action of activeActions(); track action.id; let i = $index) {
          <div
            class="flex shrink-0 flex-col items-center justify-center gap-0.5 text-xs transition-opacity"
            [class.opacity-60]="i !== highlighted()"
            [attr.data-highlighted]="i === highlighted() ? '' : null"
            [style.width.px]="step()"
          >
            @if (action.icon) {
              <ng-icon [name]="action.icon" size="22" strokeWidth="1.75" />
            }
            <!-- The icon alone is the visible cue; the name stays in the DOM (hidden) for tests and tooling. -->
            <span class="sr-only">{{ action.label }}</span>
          </div>
        }
      </div>
    }
    <div
      class="bg-background relative col-start-1 row-start-1"
      style="touch-action: pan-y"
      [style.transform]="'translateX(' + offset() + 'px)'"
      [style.transition]="dragging() ? 'none' : 'transform ' + animationMs + 'ms ease-out'"
      (pointerdown)="start($event)"
      (pointermove)="move($event)"
      (pointerup)="end($event)"
      (pointercancel)="cancel()"
    >
      <ng-content />
    </div>
  `,
})
export class SwipeActions {
  /** Actions for swiping the row to the left (revealed at the right edge). */
  readonly swipeLeft = input<readonly SwipeAction[]>([]);
  /** Actions for swiping the row to the right (revealed at the left edge). */
  readonly swipeRight = input<readonly SwipeAction[]>([]);
  /** Drag distance (px) at which the first action highlights. */
  readonly distance = input(80);
  /** Extra drag distance (px) for each further action; also the width of each revealed action. */
  readonly step = input(80);

  readonly action = output<SwipeActionEvent>();

  protected readonly animationMs = ANIMATION_MS;
  /** Signed row offset in px: negative = swiped left. */
  protected readonly offset = signal(0);
  protected readonly dragging = signal(false);

  protected readonly side = computed<'left' | 'right' | null>(() => (this.offset() < 0 ? 'left' : this.offset() > 0 ? 'right' : null));
  protected readonly activeActions = computed(() => (this.side() === 'left' ? this.swipeLeft() : this.side() === 'right' ? this.swipeRight() : []));
  protected readonly revealed = computed(() => Math.abs(this.offset()));
  protected readonly highlighted = computed(() => {
    const count = this.activeActions().length;
    const distance = this.revealed();
    if (!count || distance < this.distance()) return -1;
    return Math.min(count - 1, Math.floor((distance - this.distance()) / this.step()));
  });
  protected readonly highlightedClass = computed(() => {
    const action = this.activeActions()[this.highlighted()];
    return action ? TONE_CLASS[action.tone ?? 'neutral'] : 'bg-muted text-muted-foreground';
  });

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private swiping = false;
  private swallowClick = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // A swipe that started on a button must not also "click" it when the finger lifts.
    const onClick = (event: Event): void => {
      if (!this.swallowClick) return;
      this.swallowClick = false;
      event.stopImmediatePropagation();
      event.preventDefault();
    };
    this.element.addEventListener('click', onClick, true);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      this.element.removeEventListener('click', onClick, true);
    });
  }

  protected start(event: PointerEvent): void {
    if (event.pointerType === 'mouse' || this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.swiping = false;
    this.swallowClick = false;
  }

  protected move(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    if (!this.swiping) {
      if (Math.abs(dx) < DECIDE_AFTER_PX && Math.abs(dy) < DECIDE_AFTER_PX) return;
      const actions = dx < 0 ? this.swipeLeft() : this.swipeRight();
      if (Math.abs(dy) >= Math.abs(dx) || !actions.length) return this.release(); // scrolling, or nothing on that side
      this.swiping = true;
      this.swallowClick = true;
      this.dragging.set(true);
      (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    }
    // Never past the last action's cell, and never into a side that has no actions.
    const actions = dx < 0 ? this.swipeLeft() : this.swipeRight();
    const limit = this.distance() + actions.length * this.step();
    this.offset.set(actions.length ? Math.sign(dx) * Math.min(Math.abs(dx), limit) : 0);
  }

  protected end(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId) return;
    const swiping = this.swiping;
    this.pointerId = null;
    this.swiping = false;
    this.dragging.set(false);
    if (!swiping) return;

    const side = this.side();
    const action = this.activeActions()[this.highlighted()];
    if (!side || !action) return this.release(); // not far enough: spring back
    if (action.exit) {
      // Slide the row out, then run the action (which typically removes it).
      this.offset.set((side === 'left' ? -1 : 1) * Math.max(this.element.clientWidth, 400));
      this.timer = setTimeout(() => this.action.emit({ action, side }), ANIMATION_MS);
    } else {
      this.action.emit({ action, side });
      this.release();
    }
  }

  protected cancel(): void {
    this.pointerId = null;
    this.swiping = false;
    this.dragging.set(false);
    this.release();
  }

  /** Springs the row back to rest. */
  private release(): void {
    this.pointerId = null;
    this.dragging.set(false);
    this.offset.set(0);
  }
}
