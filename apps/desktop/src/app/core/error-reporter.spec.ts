import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DesktopApi } from '@micropos/core';
import { DESKTOP_API } from './api/desktop-api';
import { ErrorReporter } from './error-reporter';

describe('ErrorReporter', () => {
  const setup = (api: Partial<DesktopApi> | undefined) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }, { provide: ErrorHandler, useClass: ErrorReporter }] });
    return TestBed.inject(ErrorHandler);
  };

  it('sends an unhandled error to the main process log, with its stack, and still writes it to the console', () => {
    const written: unknown[] = [];
    const handler = setup({ log: { write: (entry) => (written.push(entry), Promise.resolve()) } });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('Boom');
    handler.handleError(error);
    expect(consoleError).toHaveBeenCalled();
    expect(written).toEqual([{ level: 'error', source: 'angular', message: 'Boom', details: error.stack }]);
    consoleError.mockRestore();
  });

  it('reports a thrown string, and does nothing more than the console in a plain browser or when reporting fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const written: unknown[] = [];
    setup({ log: { write: (entry) => (written.push(entry), Promise.resolve()) } }).handleError('just text');
    expect(written).toEqual([{ level: 'error', source: 'angular', message: 'just text', details: undefined }]);
    expect(() => setup(undefined).handleError(new Error('x'))).not.toThrow();
    expect(() => setup({ log: { write: () => Promise.reject(new Error('ipc down')) } }).handleError(new Error('x'))).not.toThrow();
    await Promise.resolve();
    consoleError.mockRestore();
  });
});
