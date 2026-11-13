import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { devProviders } from '../environments/dev-tools';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Hash routing: the packaged app is served over file://.
    provideRouter(routes, withHashLocation(), withComponentInputBinding()),
    // Developer-only providers (route logging): none in production builds.
    ...devProviders,
  ],
};
