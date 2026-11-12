import type { ConnectedPosition } from '@angular/cdk/overlay';

/** Space kept between a field and the keyboard or keypad floating next to it. */
export const FLOATING_GAP = 8;

/**
 * Where an on-screen keypad/keyboard may go relative to its field, in order of preference: below, above, to the
 * right, to the left. The overlay takes the first one that fits on screen; if none fits entirely it is pushed back
 * into view, so it is never clipped by the window edge.
 */
export const FLOATING_POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: FLOATING_GAP },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -FLOATING_GAP },
  { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: FLOATING_GAP },
  { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -FLOATING_GAP },
];
