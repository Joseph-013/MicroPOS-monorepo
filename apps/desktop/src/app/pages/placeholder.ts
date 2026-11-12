import { Component, input } from '@angular/core';

/** Empty screen stub until the real screen is built. `title` comes from route data. */
@Component({
  template: `<h1 class="text-2xl">{{ title() }}</h1>`,
})
export class PlaceholderPage {
  readonly title = input('');
}
