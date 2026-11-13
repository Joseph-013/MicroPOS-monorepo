import { Component, computed, HostListener, input, output, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDelete } from '@ng-icons/lucide';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@micropos/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';

/** A number pad for entering a PIN: dots show how many digits are in, a physical keyboard works too. */
@Component({
  selector: 'app-pin-pad',
  imports: [HlmButtonImports, NgIcon],
  providers: [provideIcons({ lucideDelete })],
  host: { class: 'flex w-72 flex-col items-center gap-4' },
  template: `
    <p class="text-sm" [class.text-destructive]="!!error()" role="status" aria-live="polite">{{ error() || label() }}</p>
    <div class="flex h-6 items-center gap-2" aria-hidden="true" data-pin-dots>
      @for (dot of dots(); track $index) {
        <span class="bg-foreground size-3"></span>
      }
    </div>
    <div class="grid w-full grid-cols-3 gap-2">
      @for (key of keys; track key) {
        <button hlmBtn variant="outline" type="button" class="h-16 text-xl" [disabled]="busy()" (click)="digit(key)">{{ key }}</button>
      }
      <button hlmBtn variant="outline" type="button" class="h-16" aria-label="Delete the last digit" [disabled]="busy()" (click)="back()">
        <ng-icon name="lucideDelete" size="22" />
      </button>
      <button hlmBtn variant="outline" type="button" class="h-16 text-xl" [disabled]="busy()" (click)="digit('0')">0</button>
      <button hlmBtn type="button" class="h-16" [disabled]="busy() || !complete()" (click)="submit()">{{ submitLabel() }}</button>
    </div>
  `,
})
export class PinPad {
  readonly label = input('Enter your PIN');
  readonly submitLabel = input('Sign in');
  /** Shown instead of the label (a wrong PIN, for example). */
  readonly error = input('');
  readonly busy = input(false);
  /** The finished PIN. The pad empties itself after each one. */
  readonly submitted = output<string>();
  /** The first digit typed after an error. */
  readonly typing = output<void>();

  protected readonly keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  private readonly entered = signal('');
  protected readonly dots = computed(() => Array.from({ length: this.entered().length }));
  protected readonly complete = computed(() => this.entered().length >= PIN_MIN_LENGTH);

  protected digit(key: string): void {
    if (this.entered().length >= PIN_MAX_LENGTH) return;
    if (this.entered() === '') this.typing.emit();
    this.entered.update((value) => value + key);
  }

  protected back(): void {
    this.entered.update((value) => value.slice(0, -1));
  }

  protected submit(): void {
    if (!this.complete() || this.busy()) return;
    const pin = this.entered();
    this.entered.set('');
    this.submitted.emit(pin);
  }

  /** Clears what was typed (after a wrong PIN, or when moving to another step). */
  clear(): void {
    this.entered.set('');
  }

  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^\d$/.test(event.key)) this.digit(event.key);
    else if (event.key === 'Backspace') this.back();
    else if (event.key === 'Enter') this.submit();
    else return;
    event.preventDefault();
  }
}
