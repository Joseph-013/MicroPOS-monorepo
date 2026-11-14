import type { PrinterErrorCode } from '@micropos/core';

/** A printing problem with a code the callers can act on (and text for people). */
export class PrinterError extends Error {
  constructor(
    readonly code: PrinterErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Failures worth one more try: the printer may have been busy or just woken up. */
export const isTransient = (code: PrinterErrorCode): boolean => code === 'timeout' || code === 'busy' || code === 'write-failed';
