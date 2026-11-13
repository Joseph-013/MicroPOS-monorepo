import { Component, inject, output, signal } from '@angular/core';
import { isValidPin, PIN_RULE } from '@micropos/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { AuthService } from './auth.service';

/** The signed-in person changes their own PIN: the current one, then the new one twice. */
@Component({
  selector: 'app-change-pin-form',
  imports: [HlmButtonImports, HlmInputImports, HlmLabelImports],
  template: `
    <form class="grid gap-4" (submit)="$event.preventDefault(); submit()">
      <div class="flex flex-col gap-2">
        <label hlmLabel data-required for="pin-current">Current PIN</label>
        <input hlmInput id="pin-current" type="password" inputmode="numeric" autocomplete="off" [value]="current()" (input)="current.set($any($event.target).value)" />
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel data-required for="pin-new">New PIN ({{ rule }})</label>
        <input hlmInput id="pin-new" type="password" inputmode="numeric" autocomplete="off" [value]="next()" (input)="next.set($any($event.target).value)" />
      </div>
      <div class="flex flex-col gap-2">
        <label hlmLabel data-required for="pin-repeat">Repeat the new PIN</label>
        <input hlmInput id="pin-repeat" type="password" inputmode="numeric" autocomplete="off" [value]="repeat()" (input)="repeat.set($any($event.target).value)" />
      </div>
      @if (error(); as message) { <p class="text-destructive text-sm" role="alert">{{ message }}</p> }
      <button hlmBtn type="submit" class="px-6" [disabled]="saving()">Change PIN</button>
    </form>
  `,
})
export class ChangePinForm {
  private readonly auth = inject(AuthService);
  /** Emitted once the PIN is changed. */
  readonly changed = output<void>();

  protected readonly rule = PIN_RULE;
  protected readonly current = signal('');
  protected readonly next = signal('');
  protected readonly repeat = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    if (!this.current()) return void this.error.set('Enter your current PIN');
    if (!isValidPin(this.next())) return void this.error.set(`The new PIN must be ${PIN_RULE}`);
    if (this.next() !== this.repeat()) return void this.error.set('The new PIN does not match');
    this.saving.set(true);
    this.error.set(null);
    const result = await this.auth.changePin(this.current(), this.next());
    this.saving.set(false);
    if (result.ok) this.changed.emit();
    else this.error.set(result.error);
  }
}
