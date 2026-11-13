import { Component, computed, input, output } from '@angular/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';

/**
 * The attention button every page with a nav rail badge shows beside its title: warning-coloured, labelled with the
 * number of concerns (the same number as the badge), hidden at 0, and opening a dialog that lists them with their
 * reasons. Use it with a `Concerns` dialog of the page, so each badge has one familiar place to follow up.
 * `<app-concerns-button [count]="concerns()" noun="credit concern" (opened)="showConcerns()" />`
 */
@Component({
  selector: 'app-concerns-button',
  imports: [HlmButtonImports],
  template: `
    @if (count() > 0) {
      <button
        hlmBtn
        type="button"
        class="bg-warning text-warning-foreground hover:bg-warning/90 min-w-(--control-height) px-3 font-semibold"
        [attr.aria-label]="label()"
        [attr.title]="title()"
        (click)="opened.emit()"
      >
        {{ count() }}
      </button>
    }
  `,
})
export class ConcernsButton {
  readonly count = input.required<number>();
  /** What a concern is called, singular ("credit concern"): the label reads "2 credit concerns". */
  readonly noun = input.required<string>();
  readonly opened = output<void>();

  protected readonly label = computed(() => `${this.count()} ${this.noun()}${this.count() === 1 ? '' : 's'}`);
  protected readonly title = computed(() => this.noun().replace(/^./, (c) => c.toUpperCase()) + 's');
}
