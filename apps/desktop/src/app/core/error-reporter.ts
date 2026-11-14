import { ErrorHandler, inject, Injectable } from '@angular/core';
import { DESKTOP_API } from './api/desktop-api';

/**
 * Angular's error handler, which also sends every error the page does not handle (a failing template or service, a
 * rejected promise nobody caught: `provideBrowserGlobalErrorListeners` routes those here too) to the main process,
 * where it is written to the log files with the rest (Settings > Logs). The console still gets it as before.
 */
@Injectable()
export class ErrorReporter extends ErrorHandler {
  private readonly api = inject(DESKTOP_API);

  override handleError(error: unknown): void {
    super.handleError(error);
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
    void this.api?.log.write({ level: 'error', source: 'angular', message, details: error instanceof Error ? error.stack : undefined }).catch(() => undefined);
  }
}
