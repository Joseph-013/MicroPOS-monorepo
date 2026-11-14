import { TestBed } from '@angular/core/testing';
import type { DesktopApi, SessionActivity } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { BannerService } from '../banner';
import { ACTIVITY_CHECK_MS, ACTIVITY_REPORT_MS, ActivityMonitor } from './activity-monitor';
import { AuthService } from './auth.service';
import { fakeAuthApi, sessionUser } from './testing';

describe('ActivityMonitor', () => {
  let reports: number;
  let signOuts: number;
  let answer: () => SessionActivity;
  let info: ReturnType<typeof vi.spyOn>;
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const tick = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
    await flush();
  };

  async function start(timeoutMinutes: number | null) {
    vi.useFakeTimers();
    reports = 0;
    signOuts = 0;
    const user = sessionUser(['checkout.sell']);
    answer = () => ({ user, timeoutMinutes });
    const base = fakeAuthApi({ status: user }).api;
    const api = {
      ...base,
      auth: { ...base.auth, activity: () => (reports++, Promise.resolve(answer())), signOut: () => (signOuts++, Promise.resolve()) },
    } as unknown as DesktopApi;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
    const auth = TestBed.inject(AuthService);
    await vi.advanceTimersByTimeAsync(0);
    await auth.whenReady();
    info = vi.spyOn(TestBed.inject(BannerService), 'info');
    const monitor = TestBed.inject(ActivityMonitor);
    TestBed.tick(); // runs the effect that starts the clock for the person signed in
    await flush();
    return { auth, monitor };
  }
  afterEach(() => vi.useRealTimers());

  it('learns the limit when someone is signed in', async () => {
    const { monitor } = await start(15);
    expect(reports).toBe(1);
    expect(monitor.timeoutMinutes()).toBe(15);
  });

  it('signs the person out after the limit with no input, and says so', async () => {
    const { auth } = await start(2);
    await tick(2 * 60_000 - ACTIVITY_CHECK_MS);
    expect(auth.user()).not.toBeNull(); // not yet
    await tick(ACTIVITY_CHECK_MS * 2);
    expect(auth.user()).toBeNull();
    expect(signOuts).toBe(1);
    expect(info).toHaveBeenCalledWith('Signed out after 2 minutes of inactivity', expect.anything());
  });

  it('input starts the clock again, and is reported to the main process (not more than once in a while)', async () => {
    const { auth } = await start(2);
    await tick(90_000);
    document.dispatchEvent(new Event('pointerdown')); // someone touches the screen
    await tick(ACTIVITY_REPORT_MS + ACTIVITY_CHECK_MS);
    expect(reports).toBe(2); // the sign-in, and one report for the input
    await tick(100_000); // 100 s since the touch: less than 2 minutes
    expect(auth.user()).not.toBeNull();
    for (let i = 0; i < 20; i++) document.dispatchEvent(new Event('keydown'));
    await tick(ACTIVITY_REPORT_MS * 3);
    expect(reports).toBe(3); // a burst of keys is one report
    await tick(2 * 60_000 + ACTIVITY_CHECK_MS);
    expect(auth.user()).toBeNull();
  });

  it('never signs anyone out when there is no limit', async () => {
    const { auth } = await start(null);
    await tick(10 * 60 * 60_000);
    expect(auth.user()).not.toBeNull();
    expect(signOuts).toBe(0);
  });

  it('locks the page when the main process says the session has ended', async () => {
    const { auth } = await start(30);
    answer = () => ({ user: null, timeoutMinutes: 30 }); // ended on the till's side (or a phone's session that lapsed)
    document.dispatchEvent(new Event('pointerdown'));
    await tick(ACTIVITY_REPORT_MS + ACTIVITY_CHECK_MS);
    expect(auth.user()).toBeNull();
    expect(info).toHaveBeenCalledWith('Signed out after 30 minutes of inactivity', expect.anything());
  });

  it('saves a new limit and uses it at once', async () => {
    const { monitor } = await start(null);
    const base = TestBed.inject(DESKTOP_API)!;
    (base.auth as { setSessionTimeout: unknown }).setSessionTimeout = () => Promise.resolve(true);
    expect(await monitor.setTimeout(5)).toBe(true);
    expect(monitor.timeoutMinutes()).toBe(5);
  });
});
