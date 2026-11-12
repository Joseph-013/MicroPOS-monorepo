import { TestBed } from '@angular/core/testing';
import { TooSmallOverlay } from './too-small-overlay';

function resizeTo(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  window.dispatchEvent(new Event('resize'));
}

describe('TooSmallOverlay', () => {
  afterEach(() => resizeTo(1024, 768));

  it('warns only while the window is smaller than the minimum', async () => {
    resizeTo(1400, 900);
    const fixture = TestBed.createComponent(TooSmallOverlay);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')).toBeNull();

    resizeTo(900, 900); // too narrow
    await fixture.whenStable();
    expect(el.textContent).toContain('Window too small');
    expect(el.textContent).toContain('1024 × 400');
    expect(el.textContent).toContain('Now 900 × 900');

    resizeTo(1400, 350); // too short
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();

    resizeTo(1024, 400); // exactly the minimum is fine
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });
});
