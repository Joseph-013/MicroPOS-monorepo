import net from 'node:net';
import { PrinterError } from '../errors';
import type { PrinterTransport } from './types';

const UNREACHABLE = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN']);

/** A network printer: raw ESC/POS over a TCP socket (port 9100 on nearly all of them). */
export class NetworkTransport implements PrinterTransport {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 5000,
  ) {}

  send(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let done = false;
      const finish = (error?: PrinterError): void => {
        if (done) return;
        done = true;
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };
      socket.setTimeout(this.timeoutMs, () => finish(new PrinterError('timeout', `No answer from ${this.host}:${this.port}`)));
      socket.once('error', (error: NodeJS.ErrnoException) =>
        finish(
          UNREACHABLE.has(error.code ?? '')
            ? new PrinterError('unreachable', `Cannot reach the printer at ${this.host}:${this.port}`)
            : new PrinterError('write-failed', `The printer connection failed (${error.code ?? error.message})`),
        ),
      );
      socket.once('connect', () => {
        // end() sends everything and then closes our side; its callback runs once the bytes have gone out. Printers
        // often keep their side open, so the job is not made to wait for them to close it.
        socket.end(Buffer.from(bytes), () => finish());
      });
    });
  }
}
