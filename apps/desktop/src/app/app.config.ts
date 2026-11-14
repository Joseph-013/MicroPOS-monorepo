import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { devProviders } from '../environments/dev-tools';
import { ErrorReporter } from './core/error-reporter';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Unhandled errors also go to the main process's log files.
    { provide: ErrorHandler, useClass: ErrorReporter },
    // Hash routing: the packaged app is served over file://.
    provideRouter(routes, withHashLocation(), withComponentInputBinding()),
    // Developer-only providers (route logging): none in production builds.
    ...devProviders,
  ],
};
