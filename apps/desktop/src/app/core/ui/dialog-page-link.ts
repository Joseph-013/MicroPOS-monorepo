import { Component, computed, inject, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideExternalLink } from '@ng-icons/lucide';
import { Router, RouterLink } from '@angular/router';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HIGHLIGHT_PARAM } from '../row-target';

/**
 * The link right after the title of a record dialog that opens the record's own page: a customer's account has
 * "Open Customers", a sales order "Open Sales Orders". It is only there when the dialog is over some other page.
 * Going there drops the dialog's query parameters, which closes it (and any dialog under it), and the page shows the
 * page of its table that holds the record, highlighted. Put it in the title row. The title itself always names the
 * kind of dialog ("Customer"), with the record (name or number, status) on a line under it.
 */
@Component({
  selector: 'app-dialog-page-link',
  host: { class: 'contents' },
  imports: [NgIcon, RouterLink, HlmButtonImports],
  viewProviders: [provideIcons({ lucideExternalLink })],
  template: `
    @if (!onPage()) {
      <a
        hlmBtn
        variant="ghost"
        size="icon-sm"
        [routerLink]="path()"
        [queryParams]="query()"
        [attr.aria-label]="'Open ' + label()"
        [attr.title]="'Open ' + label()"
      >
        <ng-icon name="lucideExternalLink" size="16" />
      </a>
    }
  `,
})
export class DialogPageLink {
  /** The page the record belongs to, such as `/customers`. */
  readonly path = input.required<string>();
  /** The page's name as the navigation shows it, such as `Customers`. */
  readonly label = input.required<string>();
  /** The record's id: the page highlights its row. */
  readonly highlight = input<string | null>(null);

  /** Where the dialog was opened (it does not move while the dialog is open: the page under it is the same). */
  private readonly here = inject(Router).url.split(/[?#]/)[0];
  protected readonly onPage = computed(() => this.here === this.path());
  protected readonly query = computed(() => (this.highlight() ? { [HIGHLIGHT_PARAM]: this.highlight() } : {}));
}
