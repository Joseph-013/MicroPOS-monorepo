import { DestroyRef, inject, Service } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, Router } from '@angular/router';

/**
 * Logs every route change to the console, including changes of query parameters such as a dialog opening. Development
 * only: it is started by an initializer in `environments/dev-tools.development.ts`, which production builds do not have.
 */
@Service()
export class RouteLogger {
  constructor() {
    const subscription = inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationEnd) console.log(`[route] ${event.urlAfterRedirects}`);
      else if (event instanceof NavigationCancel) console.warn(`[route] cancelled ${event.url}: ${event.reason}`);
      else if (event instanceof NavigationError) console.error(`[route] failed ${event.url}`, event.error);
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }
}
