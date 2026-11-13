import { DestroyRef, inject } from '@angular/core';
import type { DataDomain } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';

/**
 * Runs `reload` whenever the main process announces that one of these parts of the data changed (a write from any
 * window, or time alone making something a concern), once the service has loaded something to keep fresh. Call it
 * in a service's constructor (it needs an injection context); the listener ends with the service.
 */
export function refreshOnChange(domains: readonly DataDomain[], isLoaded: () => boolean, reload: () => Promise<void>): void {
  const stop = inject(DESKTOP_API)?.data?.onChanged((changed) => {
    if (isLoaded() && changed.some((d) => domains.includes(d))) void reload();
  });
  inject(DestroyRef).onDestroy(() => stop?.());
}
