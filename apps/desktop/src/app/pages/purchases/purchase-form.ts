import { Component, computed, inject, signal } from '@angular/core';
import { formatQuantity, parseQuantityMilli, lineTotal, type ProductRecord, type PurchaseDetail, type PurchaseField, type PurchaseInput } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { HlmDialogImports, HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { ProductsService } from '../../core/data/products.service';
import { PurchasesService } from '../../core/data/purchases.service';
import { SuppliersService } from '../../core/data/suppliers.service';
import { OnScreenKeypadDirective } from '../../core/keypad';
import { formatCentsInput, parseCents } from '../../core/money-input';
import { MoneyPipe } from '../../core/money.pipe';
import { AppSettings } from '../../core/settings/app-settings.service';
import { fromDateInput, toDateInput } from '../inventory/receive-stock-form';
import { SupplierForm, type SupplierFormContext } from '../suppliers/supplier-form';

export interface PurchaseFormContext {
  /** The order being changed; absent when placing a new one. */
  purchase?: PurchaseDetail;
  /** Start a new order for this supplier. */
  supplierId?: string;
}

interface Row {
  productId: string;
  name: string;
  unit: string;
  quantity: string;
  cost: string;
}

/** Place or change a purchase order: a supplier, the products with quantity and cost, and when it is expected and due. */
@Component({
  host: { class: 'contents' },
  imports: [MoneyPipe, OnScreenKeypadDirective, HlmButtonImports, HlmComboboxImports, HlmDialogImports, HlmInputImports, HlmLabelImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>{{ purchase ? 'Edit ' + purchase.number : 'New purchase' }}</h3>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); submit()">
      <div class="flex flex-col gap-2">
        <label hlmLabel data-required for="po-supplier">Supplier</label>
        <div class="flex gap-2">
          <hlm-combobox [value]="supplierId()" (valueChange)="supplierId.set($event ?? null)" [itemToString]="supplierName" class="block min-w-0 flex-1">
            <hlm-combobox-input id="po-supplier" placeholder="Search suppliers" />
            <hlm-combobox-content *hlmComboboxPortal>
              <hlm-combobox-empty>No supplier found</hlm-combobox-empty>
              <div hlmComboboxList>
                @for (s of liveSuppliers(); track s.id) {
                  <hlm-combobox-item [value]="s.id">{{ s.name }}</hlm-combobox-item>
                }
              </div>
            </hlm-combobox-content>
          </hlm-combobox>
          <button hlmBtn variant="outline" type="button" class="px-4" (click)="addSupplier()">New</button>
        </div>
        @if (errorFor('supplier'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-2">
          <label hlmLabel for="po-expected">Expected delivery</label>
          <input hlmInput id="po-expected" type="date" [forceInvalid]="invalid('expectedAt')" [value]="expected()" (input)="expected.set($any($event.target).value)" />
          @if (errorFor('expectedAt'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
        <div class="flex flex-col gap-2">
          <label hlmLabel for="po-due">Payment due</label>
          <input hlmInput id="po-due" type="date" [forceInvalid]="invalid('dueAt')" [value]="due()" (input)="due.set($any($event.target).value)" />
          @if (errorFor('dueAt'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <label hlmLabel data-required for="po-product">Products</label>
        @if (pickerShown()) {
          <hlm-combobox [value]="null" (valueChange)="add($event ?? null)" [itemToString]="productName" class="block">
            <hlm-combobox-input id="po-product" placeholder="Search a product to add" />
            <hlm-combobox-content *hlmComboboxPortal>
              <hlm-combobox-empty>No product found</hlm-combobox-empty>
              <div hlmComboboxList>
                @for (p of available(); track p.id) {
                  <hlm-combobox-item [value]="p.id">{{ p.name }}</hlm-combobox-item>
                }
              </div>
            </hlm-combobox-content>
          </hlm-combobox>
        }
        @if (rows().length) {
          <ul class="divide-border flex flex-col divide-y border-y">
            @for (row of rows(); track row.productId; let i = $index) {
              <li class="grid grid-cols-[minmax(0,1fr)_6rem_6.5rem_auto] items-center gap-2 py-2">
                <span class="min-w-0 truncate">{{ row.name }}</span>
                <input
                  hlmInput
                  type="text"
                  appOnScreenKeypad
                  [keypadWholeDigits]="5"
                  [keypadDecimals]="3"
                  [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
                  [attr.aria-label]="'Quantity of ' + row.name + (row.unit === 'each' ? '' : ' (' + row.unit + ')')"
                  [placeholder]="row.unit === 'each' ? 'Qty' : row.unit"
                  [forceInvalid]="rowInvalid(i, 'quantity')"
                  [value]="row.quantity"
                  (input)="edit(i, 'quantity', $any($event.target).value)"
                />
                <input
                  hlmInput
                  type="text"
                  appOnScreenKeypad
                  [keypadWholeDigits]="7"
                  [keypadDecimals]="2"
                  [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'decimal'"
                  [attr.aria-label]="'Cost of ' + row.name + (row.unit === 'each' ? '' : ' per ' + row.unit)"
                  placeholder="Cost"
                  [forceInvalid]="rowInvalid(i, 'cost')"
                  [value]="row.cost"
                  (input)="edit(i, 'cost', $any($event.target).value)"
                />
                <button hlmBtn variant="ghost" size="icon" type="button" [attr.aria-label]="'Remove ' + row.name" (click)="remove(i)">✕</button>
              </li>
            }
          </ul>
          <p class="text-right text-sm"><span class="text-muted-foreground">Total</span> <span class="font-heading ml-2 text-lg">{{ total() | money }}</span></p>
        }
        @if (errorFor('lines') ?? errorFor('product') ?? errorFor('quantity') ?? errorFor('unitCost'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-2">
          <label hlmLabel for="po-ref">Supplier's reference</label>
          <input hlmInput id="po-ref" type="text" placeholder="Invoice or order no." [forceInvalid]="invalid('reference')" [value]="reference()" (input)="reference.set($any($event.target).value)" />
          @if (errorFor('reference'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
        <div class="flex flex-col gap-2">
          <label hlmLabel for="po-note">Note</label>
          <input hlmInput id="po-note" type="text" [forceInvalid]="invalid('note')" [value]="note()" (input)="note.set($any($event.target).value)" />
          @if (errorFor('note'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
      </div>

      @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer>
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Cancel</button>
      <button hlmBtn type="button" class="px-6" [disabled]="saving()" (click)="submit()">{{ purchase ? 'Save' : 'Place order' }}</button>
    </hlm-dialog-footer>
  `,
})
export class PurchaseForm {
  protected readonly settings = inject(AppSettings);
  private readonly purchases = inject(PurchasesService);
  private readonly products = inject(ProductsService);
  private readonly suppliers = inject(SuppliersService);
  private readonly dialogs = inject(HlmDialogService);
  private readonly ref = inject<BrnDialogRef<PurchaseDetail | undefined>>(BrnDialogRef);
  private readonly context = injectBrnDialogContext<PurchaseFormContext>();
  protected readonly purchase = this.context.purchase;

  protected readonly supplierId = signal<string | null>(this.purchase?.supplierId ?? this.context.supplierId ?? null);
  protected readonly expected = signal(this.purchase?.expectedAt ? toDateInput(this.purchase.expectedAt) : '');
  protected readonly due = signal(this.purchase?.dueAt ? toDateInput(this.purchase.dueAt) : '');
  protected readonly reference = signal(this.purchase?.reference ?? '');
  protected readonly note = signal(this.purchase?.note ?? '');
  protected readonly rows = signal<Row[]>(
    (this.purchase?.lines ?? []).map((l) => ({ productId: l.productId, name: l.productName, unit: l.unit, quantity: formatQuantity(l.quantityMilli), cost: formatCentsInput(l.unitCost) })),
  );
  /** Hidden for a moment after a product is chosen, which recreates the picker empty. */
  protected readonly pickerShown = signal(true);
  protected readonly saving = signal(false);
  private readonly problem = signal<{ field: PurchaseField | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem()?.field === null ? this.problem()!.error : null));
  /** Rows the last attempt refused, by index and column. */
  private readonly badCells = signal<Set<string>>(new Set());

  protected readonly liveSuppliers = computed(() => this.suppliers.suppliers().filter((s) => !s.deletedAt));
  protected readonly supplierName = (id: string | null): string => this.suppliers.suppliers().find((s) => s.id === id)?.name ?? '';
  protected readonly available = computed(() => {
    const used = new Set(this.rows().map((r) => r.productId));
    return this.products.products().filter((p) => !p.deletedAt && !used.has(p.id));
  });
  protected readonly productName = (id: string | null): string => this.products.products().find((p) => p.id === id)?.name ?? '';

  protected readonly total = computed(() =>
    this.rows().reduce((sum, r) => {
      const q = parseQuantityMilli(r.quantity);
      const c = parseCents(r.cost);
      return q !== null && c !== null ? sum + lineTotal(c, q) : sum;
    }, 0),
  );

  constructor() {
    void this.products.load();
    void this.suppliers.setIncludeDeleted(false);
  }

  protected invalid(field: PurchaseField): boolean {
    return this.problem()?.field === field;
  }
  protected errorFor(field: PurchaseField): string | null {
    return this.invalid(field) ? this.problem()!.error : null;
  }
  protected rowInvalid(index: number, column: 'quantity' | 'cost'): boolean {
    return this.badCells().has(`${index}:${column}`);
  }

  protected add(id: string | null): void {
    const p: ProductRecord | undefined = this.products.products().find((x) => x.id === id);
    this.pickerShown.set(false);
    setTimeout(() => this.pickerShown.set(true));
    if (!p) return;
    this.rows.update((rows) => [...rows, { productId: p.id, name: p.name, unit: p.unit, quantity: '1', cost: formatCentsInput(p.cost) }]);
  }
  protected edit(index: number, column: 'quantity' | 'cost', value: string): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, [column]: value } : r)));
  }
  protected remove(index: number): void {
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
    this.badCells.set(new Set());
  }

  /** A supplier added from here is chosen straight away. */
  protected addSupplier(): void {
    const before = new Set(this.suppliers.suppliers().map((s) => s.id));
    this.dialogs
      .open<boolean, SupplierFormContext>(SupplierForm, {
        id: 'supplier-form',
        contentClass: 'w-[min(28rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
        context: {},
      })
      .closed$.subscribe((saved) => {
        if (!saved) return;
        const created = this.suppliers.suppliers().find((s) => !before.has(s.id));
        if (created) this.supplierId.set(created.id);
      });
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    this.problem.set(null);
    this.badCells.set(new Set());
    if (!this.supplierId()) return void this.problem.set({ field: 'supplier', error: 'Choose a supplier' });
    if (!this.rows().length) return void this.problem.set({ field: 'lines', error: 'Add at least one product' });
    const bad = new Set<string>();
    const lines = this.rows().map((r, i) => {
      const quantityMilli = parseQuantityMilli(r.quantity);
      const unitCost = r.cost.trim() === '' ? null : parseCents(r.cost);
      if (quantityMilli === null) bad.add(`${i}:quantity`);
      if (unitCost === null) bad.add(`${i}:cost`);
      return { productId: r.productId, quantityMilli: quantityMilli ?? 0, unitCost: unitCost ?? 0 };
    });
    if (bad.size) {
      this.badCells.set(bad);
      return void this.problem.set({ field: null, error: 'Enter a quantity and a cost for every product' });
    }
    const expectedAt = this.expected() ? fromDateInput(this.expected()) : null;
    const dueAt = this.due() ? fromDateInput(this.due()) : null;
    if (this.expected() && expectedAt === null) return void this.problem.set({ field: 'expectedAt', error: 'Enter a valid date' });
    if (this.due() && dueAt === null) return void this.problem.set({ field: 'dueAt', error: 'Enter a valid date' });
    const input: PurchaseInput = { supplierId: this.supplierId()!, expectedAt, dueAt, reference: this.reference().trim() || null, note: this.note().trim() || null, lines };
    this.saving.set(true);
    const result = await this.purchases.save(this.purchase?.id ?? null, input);
    this.saving.set(false);
    if (result.ok) {
      void this.suppliers.load(); // what is owed to each supplier changed
      this.ref.close(result.purchase);
    } else this.problem.set({ field: result.field, error: result.error });
  }
}
