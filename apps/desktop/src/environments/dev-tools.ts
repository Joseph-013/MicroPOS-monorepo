import type { EnvironmentProviders, Provider } from '@angular/core';
import type { Routes } from '@angular/router';

/**
 * Development-only pieces: production (the default build, and tests) has none. `dev-tools.development.ts` replaces
 * this file in the development configuration (`fileReplacements` in `angular.json`), so nothing here is built into a
 * production bundle: not the component gallery, not the route logger. Add anything else that is for developers only
 * to both files.
 */
export const devRoutes: Routes = [];
/** Entries for the nav rail (same shape as `NavItem`). */
export const devNav: { id: string; label: string; icon: string; path: string }[] = [];
export const devProviders: (Provider | EnvironmentProviders)[] = [];
