import { afterNextRender, type Injector } from '@angular/core';

/**
 * Resolves after the next render. A switch the user just flipped holds its own state; to put it back after a failed
 * save the page's value must first be rendered as the new one and then changed back, otherwise the binding sees no
 * change and the switch stays flipped. Await this between the two.
 */
export const nextRender = (injector: Injector): Promise<void> => new Promise((resolve) => afterNextRender(() => resolve(), { injector }));
