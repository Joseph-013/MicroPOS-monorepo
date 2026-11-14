import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { matchingRole, ROLE_LABELS, type UserRecord } from '@micropos/core';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmContextMenuImports } from '@spartan-ng/helm/context-menu';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { BannerService } from '../../core/banner';
import { AuthService } from '../../core/auth/auth.service';
import { UsersService } from '../../core/data/users.service';
import { AppPager, Pager } from '../../core/ui/pager';
import { UserForm, type UserFormContext } from './user-form';

/** Users: who can sign in at this till, what each may do, and the sign-ins so far. */
@Component({
  imports: [DatePipe, AppPager, HlmAlertDialogImports, HlmButtonImports, HlmCardImports, HlmContextMenuImports, HlmDropdownMenuImports],
  template: `
    <section hlmCard class="gap-0">
      <header class="flex min-h-(--control-height) items-center justify-between gap-3 border-b px-4 pb-3">
        <h1 class="text-2xl">Users</h1>
        <button hlmBtn type="button" class="px-4" (click)="open()">Add user</button>
      </header>
      <div role="table" aria-label="Users" class="min-w-[40rem] overflow-x-auto text-sm" style="--cols: minmax(10rem,2fr) 7rem 8rem minmax(10rem,1fr) 8rem">
        <div role="row" class="grid grid-cols-(--cols) border-b">
          @for (title of ['Name', 'Number', 'Role', 'Last sign-in', 'Status']; track title) {
            <div role="columnheader" class="flex h-(--control-height) items-center px-3 font-medium">{{ title }}</div>
          }
        </div>
        @for (user of service.users(); track user.id) {
          <button type="button" role="row" class="hover:bg-muted grid min-h-(--control-height) w-full grid-cols-(--cols) items-center border-b text-left" [attr.data-row-id]="user.id" [hlmContextMenuTrigger]="rowMenu" [hlmContextMenuTriggerData]="{ $implicit: user.id }" (click)="open(user)">
            <div role="cell" class="truncate px-3 text-base">{{ user.name }}@if (user.id === auth.user()?.id) { <span class="text-muted-foreground text-sm"> (you)</span> }</div>
            <div role="cell" class="text-muted-foreground px-3">{{ user.employeeNumber }}</div>
            <div role="cell" class="text-muted-foreground px-3">{{ roleLabel(user) }}</div>
            <div role="cell" class="text-muted-foreground px-3">{{ user.lastSignInAt ? (user.lastSignInAt | date: 'MMM d, y, h:mm a') : 'Never' }}</div>
            <div role="cell" class="px-3" [class.text-muted-foreground]="!user.active">{{ user.active ? (user.pinChangeRequired ? 'New PIN due' : 'Active') : 'Inactive' }}</div>
          </button>
        }
      </div>
      @if (!service.users().length) {
        <p class="text-muted-foreground py-8 text-center text-sm">{{ service.status() === 'error' ? 'Users could not be loaded' : service.status() === 'loading' ? 'Loading users' : 'No users' }}</p>
      }
    </section>

    <section hlmCard class="mt-3 gap-0">
      <header class="flex min-h-(--control-height) items-center border-b px-4 pb-3">
        <h2 class="text-xl">Sign-ins</h2>
      </header>
      <div role="table" aria-label="Sign-ins" class="min-w-[40rem] overflow-x-auto text-sm" style="--cols: minmax(10rem,2fr) minmax(12rem,1fr) minmax(12rem,1fr)">
        <div role="row" class="grid grid-cols-(--cols) border-b">
          @for (title of ['Name', 'Signed in', 'Signed out']; track title) {
            <div role="columnheader" class="flex h-(--control-height) items-center px-3 font-medium">{{ title }}</div>
          }
        </div>
        @for (entry of signInPager.rows(); track entry.id) {
          <div role="row" class="grid min-h-(--control-height) grid-cols-(--cols) items-center border-b">
            <div role="cell" class="truncate px-3">{{ entry.userName }}</div>
            <div role="cell" class="text-muted-foreground px-3">{{ entry.signedInAt | date: 'MMM d, y, h:mm a' }}</div>
            <div role="cell" class="text-muted-foreground px-3">{{ entry.signedOutAt ? (entry.signedOutAt | date: 'MMM d, y, h:mm a') : '-' }}</div>
          </div>
        }
      </div>
      @if (!service.signIns().length) {
        <p class="text-muted-foreground py-6 text-center text-sm">No sign-ins yet</p>
      }
      <app-pager [pager]="signInPager" />
    </section>

    <!-- Right-click (or long-press) menu of a user row. -->
    <ng-template #rowMenu let-id>
      @if (userById(id); as user) {
        <div hlmDropdownMenu>
          <button hlmDropdownMenuItem type="button" (click)="open(user)">Edit</button>
          @if (!user.active) {
            <button hlmDropdownMenuItem type="button" (click)="reactivate(user)">Reactivate user</button>
          } @else if (user.id !== auth.user()?.id) {
            <button hlmDropdownMenuItem variant="destructive" type="button" (click)="pendingDeactivate.set(user)">Deactivate user</button>
          }
        </div>
      }
    </ng-template>

    <!-- Deactivating asks first (the form's button does the same, inline). -->
    <hlm-alert-dialog [state]="pendingDeactivate() ? 'open' : 'closed'" (closed)="pendingDeactivate.set(null)">
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        <hlm-alert-dialog-header>
          <h3 hlmAlertDialogTitle>Deactivate {{ pendingDeactivate()?.name }}?</h3>
          <p hlmAlertDialogDescription>They are signed out at once and cannot sign in until you reactivate them. Their sales and history stay.</p>
        </hlm-alert-dialog-header>
        <hlm-alert-dialog-footer>
          <button hlmAlertDialogCancel type="button">Cancel</button>
          <button hlmAlertDialogAction variant="destructive" type="button" (click)="deactivate()">Deactivate</button>
        </hlm-alert-dialog-footer>
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class UsersPage implements OnInit {
  protected readonly service = inject(UsersService);
  protected readonly auth = inject(AuthService);
  private readonly dialogs = inject(HlmDialogService);
  private readonly banner = inject(BannerService);

  protected readonly pendingDeactivate = signal<UserRecord | null>(null);
  protected readonly signInPager = new Pager(() => this.service.signIns(), () => null);

  ngOnInit(): void {
    void this.service.load();
  }

  /** The preset the person's permissions match, or Custom. */
  protected roleLabel(user: UserRecord): string {
    const role = matchingRole(user.permissions);
    return role ? ROLE_LABELS[role] : 'Custom';
  }

  /** The menu is given only a row id, so the row is looked up fresh. */
  protected userById(id: string): UserRecord | undefined {
    return this.service.users().find((u) => u.id === id);
  }

  protected async deactivate(): Promise<void> {
    const user = this.pendingDeactivate();
    this.pendingDeactivate.set(null);
    if (user) await this.change(user, false);
  }

  protected reactivate(user: UserRecord): Promise<void> {
    return this.change(user, true);
  }

  private async change(user: UserRecord, active: boolean): Promise<void> {
    const result = await this.service.setActive(user, active);
    if (result.ok) this.banner.success(`${user.name} ${active ? 'reactivated' : 'deactivated'}`, { key: 'user-active' });
    else this.banner.error(result.error, { key: 'user-active', duration: 'long' });
  }

  protected open(user?: UserRecord): void {
    this.dialogs
      .open<boolean, UserFormContext>(UserForm, {
        id: 'user-form',
        contentClass: 'w-[min(36rem,95vw)] max-w-none sm:max-w-none max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]',
        context: { user },
      })
      .closed$.subscribe((saved) => {
        if (saved) this.banner.success(user ? 'User saved' : 'User added', { key: 'user-saved' });
      });
  }
}
