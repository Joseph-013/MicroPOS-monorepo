import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { Permission } from '@micropos/core';
import { AuthService } from './auth.service';

/**
 * Keeps someone from opening a page their permissions do not cover (typing its address, a saved last page, an old
 * link): they land on the first page they may use. While the till is locked nothing is shown, so nothing is checked;
 * the page is checked again when someone signs in (`AuthService.signIn`).
 */
export const permissionGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const router = inject(Router); // inject() only works before the first await
  await auth.whenReady();
  const needed = route.data['permission'] as Permission | undefined;
  if (!needed || !auth.user() || auth.can(needed)) return true;
  return router.parseUrl(auth.homeUrl());
};

/** Route options for a page that needs `permission`. */
export const requires = (permission: Permission): { canActivate: [typeof permissionGuard]; data: { permission: Permission } } => ({
  canActivate: [permissionGuard],
  data: { permission },
});
