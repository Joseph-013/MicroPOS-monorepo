import { FileLogger } from './file-logger';

/**
 * The app's log. Until `initLogging` runs (and in tests) it only writes to the console; afterwards everything also goes
 * to the log files, which the admin can open from Settings > Logs.
 */
let current: FileLogger | null = null;

export function initLogging(dir: string, mirror: boolean): FileLogger {
  current = new FileLogger({ dir, mirror });
  current.prune();
  return current;
}

export const logDirectory = (): string | null => current?.directory ?? null;

export const log = {
  error: (source: string, message: string, details?: unknown): void => (current ? current.error(source, message, details) : console.error(`[${source}] ${message}`, details ?? '')),
  warn: (source: string, message: string, details?: unknown): void => (current ? current.warn(source, message, details) : console.warn(`[${source}] ${message}`, details ?? '')),
  info: (source: string, message: string, details?: unknown): void => (current ? current.info(source, message, details) : undefined),
};
