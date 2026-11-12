import { Component, computed, inject, signal } from '@angular/core';
import type { CategoryField, CategoryRecord } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { CatalogService } from '../../core/data/catalog.service';
import { CategoriesService } from '../../core/data/categories.service';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { AppSettings } from '../../core/settings/app-settings.service';

export interface CategoryFormContext {
  /** The category being edited; absent when adding. */
  category?: CategoryRecord;
}

/** Add / edit dialog of the Categories page. Closes with `true` once the change is saved. */
@Component({
  // `contents`: the dialog's own grid lays out the header, form and footer directly.
  host: { class: 'contents' },
  imports: [OnScreenKeypadDirective, HlmAlertDialogImports, HlmButtonImports, HlmDialogImports, HlmInputImports, HlmLabelImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>{{ category ? 'Edit category' : 'Add category' }}</h3>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); submit()">
      <div class="flex flex-col gap-2">
        <label hlmLabel data-required for="c-name">Name</label>
        <input hlmInput id="c-name" type="text" [forceInvalid]="invalid('name')" [value]="name()" (input)="name.set($any($event.target).value)" />
        @if (errorFor('name'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel for="c-order">Order</label>
        <input
          hlmInput
          id="c-order"
          type="text"
          appOnScreenKeypad
          [keypadWholeDigits]="4"
          [keypadDecimals]="0"
          [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'numeric'"
          [forceInvalid]="invalid('sortOrder')"
          [value]="sortOrder()"
          (input)="sortOrder.set($any($event.target).value)"
        />
        @if (errorFor('sortOrder'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>
      @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer class="sm:justify-between">
      @if (category) {
        <hlm-alert-dialog>
          <button hlmAlertDialogTrigger hlmBtn variant="destructive" type="button" class="px-5">Delete</button>
          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
            <hlm-alert-dialog-header>
              <h3 hlmAlertDialogTitle>Delete this category?</h3>
              <p hlmAlertDialogDescription>Its products keep their other categories.</p>
            </hlm-alert-dialog-header>
            <hlm-alert-dialog-footer>
              <button hlmAlertDialogCancel type="button">Cancel</button>
              <button hlmAlertDialogAction variant="destructive" type="button" (click)="remove()">Delete</button>
            </hlm-alert-dialog-footer>
          </hlm-alert-dialog-content>
        </hlm-alert-dialog>
      } @else {
        <span></span>
      }
      <div class="flex gap-2">
        <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Cancel</button>
        <button hlmBtn type="button" class="px-6" [disabled]="saving()" (click)="submit()">Save</button>
      </div>
    </hlm-dialog-footer>
  `,
})
export class CategoryForm {
  protected readonly settings = inject(AppSettings);
  private readonly categories = inject(CategoriesService);
  private readonly catalog = inject(CatalogService);
  private readonly ref = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  protected readonly category = injectBrnDialogContext<CategoryFormContext>().category;

  protected readonly name = signal(this.category?.name ?? '');
  protected readonly sortOrder = signal(String(this.category?.sortOrder ?? 0));
  protected readonly saving = signal(false);
  private readonly problem = signal<{ field: CategoryField | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem()?.field === null ? this.problem()!.error : null));

  protected invalid(field: CategoryField): boolean {
    return this.problem()?.field === field;
  }
  protected errorFor(field: CategoryField): string | null {
    return this.invalid(field) ? this.problem()!.error : null;
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    this.problem.set(null);
    if (!this.name().trim()) return void this.problem.set({ field: 'name', error: 'Enter a name' });
    const order = this.sortOrder().trim() === '' ? 0 : Number(this.sortOrder());
    if (!/^\d{1,4}$/.test(this.sortOrder().trim() || '0')) return void this.problem.set({ field: 'sortOrder', error: 'Enter a whole number' });
    this.saving.set(true);
    const result = await this.categories.save(this.category?.id ?? null, { name: this.name(), sortOrder: order });
    this.saving.set(false);
    if (result.ok) {
      void this.catalog.load(); // checkout and the product form list categories too
      this.ref.close(true);
    } else this.problem.set({ field: result.field, error: result.error });
  }

  protected async remove(): Promise<void> {
    if (this.category && (await this.categories.remove([this.category.id]))) {
      void this.catalog.load();
      this.ref.close(true);
    } else this.problem.set({ field: null, error: 'Could not delete the category' });
  }
}
