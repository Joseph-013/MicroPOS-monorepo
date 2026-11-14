import { Component, computed, inject, signal } from '@angular/core';
import { matchingRole, PERMISSIONS, type Permission, PIN_RULE, ROLE_LABELS, ROLE_PRESETS, type SaveUserResult, USER_ROLES, type UserField, type UserRecord, type UserRole } from '@micropos/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { UsersService } from '../../core/data/users.service';

export interface UserFormContext {
  /** The user being edited; absent when adding. */
  user?: UserRecord;
}

const CUSTOM = 'custom';
type Preset = UserRole | typeof CUSTOM;

/** Add / edit dialog of the Users page: who they are, what they may do (a preset to start from, then each switch), and a PIN. */
@Component({
  host: { class: 'contents' },
  imports: [HlmButtonImports, HlmDialogImports, HlmInputImports, HlmLabelImports, HlmSelectImports, HlmSwitchImports],
  template: `
    <hlm-dialog-header>
      <h3 hlmDialogTitle>{{ user ? 'Edit user' : 'Add user' }}</h3>
    </hlm-dialog-header>

    <form class="-mx-2 grid min-h-0 gap-4 overflow-y-auto px-2 py-1" (submit)="$event.preventDefault(); submit()">
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="flex flex-col gap-2">
          <label hlmLabel data-required for="user-name">Name</label>
          <input hlmInput id="user-name" type="text" [forceInvalid]="invalid('name')" [value]="name()" (input)="name.set($any($event.target).value)" />
          @if (errorFor('name'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
        <div class="flex flex-col gap-2">
          <label hlmLabel data-required for="user-number">Employee number</label>
          <input hlmInput id="user-number" type="text" [forceInvalid]="invalid('employeeNumber')" [value]="number()" (input)="number.set($any($event.target).value)" />
          @if (errorFor('employeeNumber'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
      </div>

      @if (!user) {
        <div class="flex flex-col gap-2">
          <label hlmLabel data-required for="user-pin">Starting PIN ({{ pinRule }})</label>
          <input hlmInput id="user-pin" type="password" inputmode="numeric" autocomplete="off" [forceInvalid]="invalid('pin')" [value]="pin()" (input)="pin.set($any($event.target).value)" />
          <p class="text-muted-foreground text-sm">They choose their own PIN the first time they sign in.</p>
          @if (errorFor('pin'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
        </div>
      }

      <div class="flex flex-col gap-2">
        <span hlmLabel id="user-preset-label">Starts from</span>
        <hlm-select [value]="preset()" (valueChange)="choosePreset($event)" [itemToString]="presetLabel">
          <hlm-select-trigger class="w-full sm:w-60" aria-labelledby="user-preset-label">
            <hlm-select-value />
          </hlm-select-trigger>
          <hlm-select-content *hlmSelectPortal>
            @for (option of presets; track option) {
              <hlm-select-item [value]="option">{{ presetLabel(option) }}</hlm-select-item>
            }
          </hlm-select-content>
        </hlm-select>
        <p class="text-muted-foreground text-sm">Picking one switches on what that role usually needs. Each switch below can still be changed.</p>
      </div>

      <fieldset class="flex flex-col gap-3" [attr.aria-invalid]="invalid('permissions')">
        <legend hlmLabel class="mb-1">May do</legend>
        @for (group of groups; track group.name) {
          <div class="flex flex-col">
            <h4 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ group.name }}</h4>
            @for (permission of group.items; track permission.id) {
              <label class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
                <span class="flex flex-col">
                  <span>{{ permission.label }}</span>
                  <span class="text-muted-foreground text-xs">{{ permission.description }}</span>
                </span>
                <hlm-switch [attr.aria-label]="permission.label" [checked]="has(permission.id)" (checkedChange)="toggle(permission.id, $event)" />
              </label>
            }
          </div>
        }
        @if (errorFor('permissions'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      </fieldset>

      <label class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
        <span class="flex flex-col">
          <span>Active</span>
          <span class="text-muted-foreground text-xs" data-active-hint>
            {{ active() ? 'Can sign in. Turn off to lock them out; their history is kept.' : 'Inactive: cannot sign in. Turn on to let them in again.' }}
          </span>
        </span>
        <hlm-switch aria-label="Active" [checked]="active()" (checkedChange)="active.set($event)" />
      </label>
      @if (errorFor('active'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }

      @if (user) {
        <div class="flex flex-col gap-2 border-t pt-4">
          <label hlmLabel for="user-reset">Reset PIN ({{ pinRule }})</label>
          <div class="flex gap-2">
            <input hlmInput id="user-reset" class="flex-1" type="password" inputmode="numeric" autocomplete="off" [value]="newPin()" (input)="newPin.set($any($event.target).value)" />
            <button hlmBtn variant="outline" type="button" class="px-5" [disabled]="!newPin() || saving()" (click)="resetPin()">Reset PIN</button>
          </div>
          <p class="text-muted-foreground text-sm">They must choose a new PIN the next time they sign in.</p>
          @if (resetMessage(); as message) { <p class="text-sm" [class.text-destructive]="resetFailed()">{{ message }}</p> }
        </div>
      }
      @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
    </form>

    <hlm-dialog-footer>
      <button hlmBtn hlmDialogClose variant="outline" type="button" class="px-5">Cancel</button>
      <button hlmBtn type="button" class="px-6" [disabled]="saving()" (click)="submit()">Save</button>
    </hlm-dialog-footer>
  `,
})
export class UserForm {
  private readonly users = inject(UsersService);
  private readonly ref = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  protected readonly user = injectBrnDialogContext<UserFormContext>().user;

  protected readonly pinRule = PIN_RULE;
  protected readonly presets: Preset[] = [...USER_ROLES, CUSTOM];
  protected readonly groups = [...new Set(PERMISSIONS.map((p) => p.group))].map((name) => ({ name, items: PERMISSIONS.filter((p) => p.group === name) }));

  protected readonly name = signal(this.user?.name ?? '');
  protected readonly number = signal(this.user?.employeeNumber ?? '');
  protected readonly pin = signal('');
  protected readonly active = signal(this.user?.active ?? true);
  protected readonly permissions = signal<Permission[]>(this.user ? [...this.user.permissions] : [...ROLE_PRESETS.cashier]);
  /** The role the permissions started from (kept as the label when they are then customised). */
  private readonly role = signal<UserRole>(this.user?.role ?? 'cashier');
  protected readonly preset = computed<Preset>(() => matchingRole(this.permissions()) ?? CUSTOM);

  protected readonly newPin = signal('');
  protected readonly resetMessage = signal<string | null>(null);
  protected readonly resetFailed = signal(false);

  protected readonly saving = signal(false);
  private readonly problem = signal<{ field: UserField | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem()?.field === null ? this.problem()!.error : null));

  protected readonly presetLabel = (preset: Preset): string => (preset === CUSTOM ? 'Custom' : ROLE_LABELS[preset]);

  protected invalid(field: UserField): boolean {
    return this.problem()?.field === field;
  }
  protected errorFor(field: UserField): string | null {
    return this.invalid(field) ? this.problem()!.error : null;
  }

  protected has(permission: Permission): boolean {
    return this.permissions().includes(permission);
  }

  protected toggle(permission: Permission, on: boolean): void {
    this.permissions.update((list) => (on ? PERMISSIONS.map((p) => p.id).filter((id) => id === permission || list.includes(id)) : list.filter((p) => p !== permission)));
  }

  protected choosePreset(preset: Preset | null | undefined): void {
    if (!preset || preset === CUSTOM) return;
    this.role.set(preset);
    this.permissions.set([...ROLE_PRESETS[preset]]);
  }

  protected async submit(): Promise<void> {
    if (this.saving()) return;
    this.problem.set(null);
    this.saving.set(true);
    const result: SaveUserResult = await this.users.save(this.user?.id ?? null, {
      name: this.name(),
      employeeNumber: this.number(),
      role: matchingRole(this.permissions()) ?? this.role(),
      permissions: this.permissions(),
      active: this.active(),
      pin: this.user ? undefined : this.pin(),
    });
    this.saving.set(false);
    if (result.ok) this.ref.close(true);
    else this.problem.set({ field: result.field, error: result.error });
  }

  protected async resetPin(): Promise<void> {
    if (!this.user) return;
    this.saving.set(true);
    const result = await this.users.resetPin(this.user.id, this.newPin());
    this.saving.set(false);
    this.resetFailed.set(!result.ok);
    this.resetMessage.set(result.ok ? 'PIN reset' : result.error);
    if (result.ok) this.newPin.set('');
  }
}
