import { describe, expect, it } from 'vitest';
import { handleSquirrelEvent } from './squirrel';

describe('handleSquirrelEvent', () => {
  it('ignores ordinary starts and other platforms', () => {
    expect(handleSquirrelEvent(['app.exe'], 'C:\app\app.exe', 'win32')).toBe(false);
    expect(handleSquirrelEvent(['app.exe', '--squirrel-firstrun'], 'C:\app\app.exe', 'win32')).toBe(false);
    expect(handleSquirrelEvent(['app', '--squirrel-install'], '/usr/bin/app', 'linux')).toBe(false);
  });

  it('answers the obsolete event without side effects', () => {
    expect(handleSquirrelEvent(['app.exe', '--squirrel-obsolete'], 'C:\app\app.exe', 'win32')).toBe(true);
  });
});
