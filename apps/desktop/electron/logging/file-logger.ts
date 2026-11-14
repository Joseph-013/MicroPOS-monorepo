import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'error' | 'warn' | 'info';

export interface FileLoggerOptions {
  /** The folder the log files go in (created when missing). */
  dir: string;
  /** Days of files kept; older ones are deleted when the app starts (`prune`). */
  keepDays?: number;
  /** A file that reaches this size is left alone and the entry goes to the next one of that day. */
  maxFileBytes?: number;
  now?: () => Date;
  /** Also print to the console (development). */
  mirror?: boolean;
}

const FILE_PATTERN = /^micropos-(\d{4})-(\d{2})-(\d{2})(?:-(\d+))?\.log$/;
const MAX_DETAIL_CHARS = 8000;

/** The text of an error or any value: an Error's stack, otherwise a string or its JSON, cut to a sane length. */
export function describeError(value: unknown): string {
  let text: string;
  if (value instanceof Error) text = value.stack ?? `${value.name}: ${value.message}`;
  else if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}... (cut)` : text;
}

/**
 * Plain text log files, one per day (`micropos-2026-11-14.log`), so anyone can open, copy or send them: one entry per
 * line, `2026-11-14T04:12:03.123Z ERROR [source] message`, with a stack or details on the lines under it, indented.
 * Writing never throws (a log must not break the app) and entries are appended at once, so a crash keeps what came
 * before it. Never log secrets: callers pass messages and errors, not request data.
 */
export class FileLogger {
  private readonly keepDays: number;
  private readonly maxFileBytes: number;
  private readonly now: () => Date;

  constructor(private readonly options: FileLoggerOptions) {
    this.keepDays = options.keepDays ?? 14;
    this.maxFileBytes = options.maxFileBytes ?? 5 * 1024 * 1024;
    this.now = options.now ?? (() => new Date());
  }

  get directory(): string {
    return this.options.dir;
  }

  error(source: string, message: string, details?: unknown): void {
    this.write('error', source, message, details);
  }
  warn(source: string, message: string, details?: unknown): void {
    this.write('warn', source, message, details);
  }
  info(source: string, message: string, details?: unknown): void {
    this.write('info', source, message, details);
  }

  /** The file today's entries go to. */
  currentFile(): string {
    const date = this.now();
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    for (let n = 0; ; n++) {
      const file = path.join(this.options.dir, `micropos-${day}${n ? `-${n}` : ''}.log`);
      try {
        if (fs.statSync(file).size < this.maxFileBytes) return file;
      } catch {
        return file; // does not exist yet
      }
    }
  }

  private write(level: LogLevel, source: string, message: string, details?: unknown): void {
    const lines = [`${this.now().toISOString()} ${level.toUpperCase().padEnd(5)} [${source}] ${message.replace(/\r?\n/g, ' ')}`];
    if (details !== undefined) lines.push(...describeError(details).split(/\r?\n/).map((l) => `    ${l}`));
    const entry = `${lines.join('\n')}\n`;
    if (this.options.mirror) (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(entry.trimEnd());
    try {
      fs.mkdirSync(this.options.dir, { recursive: true });
      fs.appendFileSync(this.currentFile(), entry);
    } catch {
      // Nowhere to write: nothing more can be done about it.
    }
  }

  /** Deletes log files older than `keepDays` (by the date in their name). Returns how many went. */
  prune(): number {
    let removed = 0;
    const cutoff = this.now().getTime() - this.keepDays * 86_400_000;
    try {
      for (const name of fs.readdirSync(this.options.dir)) {
        const match = FILE_PATTERN.exec(name);
        if (!match) continue; // never touch files that are not ours
        if (new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() < cutoff) {
          fs.rmSync(path.join(this.options.dir, name), { force: true });
          removed++;
        }
      }
    } catch {
      // No folder yet.
    }
    return removed;
  }
}
