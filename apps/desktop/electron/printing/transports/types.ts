/**
 * A way to get bytes to a printer. One call is one print job: it connects, sends everything, and lets go again, so
 * nothing stays claimed between jobs and every job starts from the same state (a printer that was just switched on is
 * no different from one that printed a minute ago). It throws a `PrinterError` when the job did not go through.
 */
export interface PrinterTransport {
  send(bytes: Uint8Array): Promise<void>;
}
