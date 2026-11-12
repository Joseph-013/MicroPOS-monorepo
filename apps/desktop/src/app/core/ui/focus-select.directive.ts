import { afterNextRender, Directive, ElementRef, inject } from '@angular/core';

/** Focuses the element as soon as it is rendered and selects its contents, so typing replaces the value. */
@Directive({ selector: 'input[appFocusSelect]' })
export class FocusSelectDirective {
  constructor() {
    const input = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      input.focus();
      input.select();
    });
  }
}
