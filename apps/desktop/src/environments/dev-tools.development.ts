import { type EnvironmentProviders, inject, type Provider, provideAppInitializer } from '@angular/core';
import type { Routes } from '@angular/router';
import { RouteLogger } from '../app/core/route-logger';

/** Development version of `dev-tools.ts` (see there). */
export const devRoutes: Routes = [
  {
    path: 'components',
    title: 'Components',
    loadComponent: () => import('../app/pages/components').then((m) => m.ComponentsPage),
  },
];
export const devNav = [{ id: 'components', label: 'Components', icon: 'lucideLayoutGrid', path: '/components' }];
/** Logs every route change to the console. */
export const devProviders: (Provider | EnvironmentProviders)[] = [provideAppInitializer(() => void inject(RouteLogger))];
