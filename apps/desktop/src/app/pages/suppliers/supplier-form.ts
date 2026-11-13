import { Component, computed, inject, signal } from '@angular/core';
import type { SupplierField, SupplierRecord } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { SuppliersService } from '../../core/data/suppliers.service';

export interface SupplierFormContext {
  /** The supplier being edited; absent when adding. */
  supplier?: SupplierRecord;
}

/** Add / edit dialog of the Suppliers page. Closes with `true` once the change is saved. */
@Component({
  host: { class: 'contents' },
  imports: [HlmAlertDialogImports, HlmButtonImports, HlmDialogImports, HlmInputImports, HlmLabelImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>{{ supplier ? 'Edit supplier' : 'Add supplier' }}</h3>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); submit()">
      <div class="flex flex-col gap-2">
        <label hlmLabel data-required for="sup-name">Name</label>
        <input hlmInput id="sup-name" type="text" [forceInvalid]="invalid('name')" [value]="name()" (input)="name.set($any($event.target).value)" />
        @if (errorFor('name'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel for="sup-phone">Phone</label>
        <input hlmInput id="sup-phone" type="text" [forceInvalid]="invalid('phone')" [value]="phone()" (input)="phone.set($any($event.target).value)" />
        @if (errorFor('phone'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel for="sup-note">Note</label>
        <input hlmInput id="sup-note" type="text" [forceInvalid]="invalid('note')" [value]="note()" (input)="note.set($any($event.target).value)" />
        @if (errorFor('note'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>
      @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer class="sm:justify-between">
      @if (supplier) {
        <hlm-alert-dialog>
          <button hlmAlertDialogTrigger hlmBtn variant="destructive" type="button" class="px-5">Delete</button>
          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
            <hlm-alert-dialog-header>
              <h3 hlmAlertDialogTitle>Delete {{ supplier.name }}?</h3>
              <p hlmAlertDialogDescription>Their past purchase orders are kept. A supplier you still owe money, or with an order on the way, cannot be deleted.</p>
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
export class SupplierForm {
  private readonly suppliers = inject(SuppliersService);
  private readonly ref = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  protected readonly supplier = injectBrnDialogContext<SupplierFormContext>().supplier;

  protected readonly name = signal(this.supplier?.name ?? '');
  protected readonly phone = signal(this.supplier?.phone ?? '');
  protected readonly note = signal(this.supplier?.note ?? '');
  protected readonly saving = signal(false);
  private readonly problem = signal<{ field: SupplierField | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem()?.field === null ? this.problem()!.error : null));

  protected invalid(field: SupplierField): boolean {
    return this.problem()?.field === field;
  }
  protected errorFor(field: SupplierField): string | null {
    return this.invalid(field) ? this.problem()!.error : null;
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    this.problem.set(null);
    if (!this.name().trim()) return void this.problem.set({ field: 'name', error: 'Enter a name' });
    this.saving.set(true);
    const result = await this.suppliers.save(this.supplier?.id ?? null, { name: this.name(), phone: this.phone() || null, note: this.note() || null });
    this.saving.set(false);
    if (result.ok) this.ref.close(true);
    else this.problem.set({ field: result.field, error: result.error });
  }

  protected async remove(): Promise<void> {
    if (!this.supplier) return;
    const result = await this.suppliers.remove([this.supplier.id]);
    if (result?.removed) this.ref.close(true);
    else this.problem.set({ field: null, error: result?.blocked.length ? 'This supplier is still owed money or has an order on the way' : 'Could not delete the supplier' });
  }
}
