import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { isLanDevice, pairFromAddress, showNotPaired } from './app/core/api/remote-api';

/**
 * Opened from the till's address on a phone or tablet, the device must be paired first (the QR code on the till holds a
 * one-time code in the address); otherwise it only says how. The Electron window and a plain browser start at once.
 */
async function start(): Promise<void> {
  if (isLanDevice()) {
    const paired = await pairFromAddress();
    if (paired.state !== 'paired') {
      showNotPaired(document.querySelector('app-root') ?? document.body, paired.state === 'refused' ? paired.error : null);
      return;
    }
  }
  await bootstrapApplication(App, appConfig);
}

start().catch((err) => console.error(err));
