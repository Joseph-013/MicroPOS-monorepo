import { Directive } from '@angular/core';
import { classes } from '@spartan-ng/helm/utils';

@Directive({
  selector: '[hlmDialogFooter],hlm-dialog-footer',
  exportAs: 'hlmDialogFooter',
  host: { 'data-slot': 'dialog-footer' },
})
export class HlmDialogFooter {
  constructor() {
    classes(
      () =>
        '-mx-4 -mb-4 border-t p-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
    );
  }
}
