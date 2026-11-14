import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeError, FileLogger } from './file-logger';

let dir: string;
let when = new Date(2026, 10, 14, 12, 0, 0);
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-log-'));
  when = new Date(2026, 10, 14, 12, 0, 0);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const files = (): string[] => fs.readdirSync(dir).sort();
const make = (over: Partial<ConstructorParameters<typeof FileLogger>[0]> = {}) => new FileLogger({ dir: path.join(dir, 'logs'), now: () => when, ...over });

describe('FileLogger', () => {
  it('writes one readable line per entry, with a stack or details indented under it, into a file named for the day', () => {
    const log = make();
    log.info('app', 'started');
    log.error('ipc:customers:create', 'Something failed', new Error('boom'));
    log.warn('printer', 'slow', { host: '10.0.0.5' });
    expect(fs.readdirSync(path.join(dir, 'logs'))).toEqual(['micropos-2026-11-14.log']);
    const text = fs.readFileSync(log.currentFile(), 'utf8');
    const lines = text.split('\n');
    expect(lines[0]).toBe(`${when.toISOString()} INFO  [app] started`);
    expect(lines[1]).toBe(`${when.toISOString()} ERROR [ipc:customers:create] Something failed`);
    expect(lines[2]).toBe('    Error: boom');
    expect(text).toContain('    at '); // the stack, indented
    expect(text).toContain(`WARN  [printer] slow\n    {"host":"10.0.0.5"}`);
  });

  it('keeps a message to one line, creates the folder, and never throws when it cannot write', () => {
    const log = make();
    log.error('x', 'line one\nline two');
    expect(fs.readFileSync(log.currentFile(), 'utf8')).toContain('[x] line one line two\n');
    fs.writeFileSync(path.join(dir, 'blocker'), 'a file where the folder should go');
    expect(() => make({ dir: path.join(dir, 'blocker', 'logs') }).error('x', 'nowhere to write')).not.toThrow();
  });

  it('moves on to the next file of the day when one is full, so nothing is dropped', () => {
    const log = make({ maxFileBytes: 200 });
    for (let i = 0; i < 12; i++) log.error('x', `entry number ${i} with some padding to fill the file`);
    const names = fs.readdirSync(path.join(dir, 'logs')).sort();
    expect(names.length).toBeGreaterThan(1);
    expect(names[0]).toBe('micropos-2026-11-14-1.log');
    const all = names.map((n) => fs.readFileSync(path.join(dir, 'logs', n), 'utf8')).join('');
    for (let i = 0; i < 12; i++) expect(all).toContain(`entry number ${i} `);
  });

  it('starts a new file each day, and prunes only its own old files', () => {
    const log = make({ keepDays: 14 });
    log.info('a', 'day one');
    when = new Date(2026, 10, 20, 9, 0, 0);
    log.info('a', 'later');
    when = new Date(2026, 11, 5, 9, 0, 0); // 21 days after the first, 15 after the second
    log.info('a', 'much later');
    const folder = path.join(dir, 'logs');
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'not ours');
    expect(log.prune()).toBe(2);
    expect(fs.readdirSync(folder).sort()).toEqual(['micropos-2026-12-05.log', 'notes.txt']);
  });

  it('describes errors and other values', () => {
    expect(describeError(new Error('x'))).toContain('Error: x');
    expect(describeError('text')).toBe('text');
    expect(describeError({ a: 1 })).toBe('{"a":1}');
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(describeError(circular)).toBe('[object Object]');
    expect(describeError('x'.repeat(9000)).length).toBeLessThan(8100);
  });
});
