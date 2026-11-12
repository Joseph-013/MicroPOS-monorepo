import { TestBed } from '@angular/core/testing';
import { BannerHost } from './banner-host';
import { BannerService } from './banner.service';

describe('BannerHost', () => {
  it('renders the current banner with its severity and dismisses on click', async () => {
    const fixture = TestBed.createComponent(BannerHost);
    const banner = TestBed.inject(BannerService);
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    expect(el.querySelector('button')).toBeNull();

    banner.error('Something failed', { duration: 'persistent' });
    await fixture.whenStable();
    const strip = el.querySelector('button')!;
    expect(strip.textContent?.trim()).toBe('Something failed');
    expect(strip.getAttribute('role')).toBe('alert');
    expect(strip.getAttribute('data-severity')).toBe('error');
    expect(strip.className).toContain('bg-destructive');

    banner.success('Saved', { duration: 'persistent' });
    banner.dismiss();
    banner.dismiss(); // each dismiss removes the newest persistent banner
    await fixture.whenStable();
    expect(el.querySelector('button')).toBeNull(); // clicking or dismiss removes it

    strip.click();
  });

  it('a non-dismissible persistent banner ignores clicks until removed', async () => {
    const fixture = TestBed.createComponent(BannerHost);
    const banner = TestBed.inject(BannerService);
    banner.warning('Update at 22:00', { duration: 'persistent', key: 'update', dismissible: false });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector('button')!.click();
    await fixture.whenStable();
    expect(el.querySelector('button')).not.toBeNull();
    banner.remove('update');
    await fixture.whenStable();
    expect(el.querySelector('button')).toBeNull();
  });

  it('uses a status role for non-urgent severities', async () => {
    const fixture = TestBed.createComponent(BannerHost);
    TestBed.inject(BannerService).success('Added');
    await fixture.whenStable();
    const strip = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(strip.getAttribute('role')).toBe('status');
    expect(strip.className).toContain('bg-success');
    TestBed.inject(BannerService).clear();
  });

  it('shows an action button on the strip; pressing it runs the action and dismisses the banner', async () => {
    const fixture = TestBed.createComponent(BannerHost);
    const banner = TestBed.inject(BannerService);
    const run = vi.fn();
    banner.success('Order SO-1001 completed', { duration: 'persistent', action: { label: 'View', run } });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const [strip, action] = Array.from(el.querySelectorAll('button'));
    expect(strip.textContent?.trim()).toBe('Order SO-1001 completed');
    expect(action.textContent?.trim()).toBe('View');
    expect(action.previousElementSibling).toBe(strip); // right beside the message
    action.click();
    await fixture.whenStable();
    expect(run).toHaveBeenCalledOnce();
    expect(el.querySelector('button')).toBeNull();
  });
});
