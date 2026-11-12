import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NavRail } from './nav-rail';

/** jsdom has no PointerEvent; a plain event carrying `pointerType` is all the rail reads. */
const pointer = (type: string, target: Element, pointerType: string): void => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
};

describe('NavRail on touch', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', children: [] }])] });
  });

  const setup = () => {
    const fixture = TestBed.createComponent(NavRail);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rail = el.querySelector('nav') as HTMLElement;
    const link = el.querySelector('a[href="/checkout"]') as HTMLAnchorElement;
    return { fixture, rail, link };
  };

  it('the first tap only opens a collapsed rail; the second follows the link', async () => {
    const { fixture, rail, link } = setup();
    expect(rail.style.width).toBe('3.5rem');

    pointer('pointerdown', link, 'touch');
    const first = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(first);
    fixture.detectChanges();
    expect(first.defaultPrevented).toBe(true); // did not navigate
    expect(rail.style.width).toBe('16rem');

    pointer('pointerdown', link, 'touch');
    const second = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true); // routerLink handled it (it prevents the browser navigation itself)
    await fixture.whenStable();
  });

  it('with a mouse the rail stays open after following a link, and folds when the pointer leaves', async () => {
    const { fixture, rail, link } = setup();
    rail.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(rail.style.width).toBe('16rem');

    pointer('pointerdown', link, 'mouse');
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(rail.style.width).toBe('16rem'); // still open after navigating

    rail.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
    expect(rail.style.width).toBe('3.5rem');
  });

  it('a tap outside folds an opened rail', () => {
    const { fixture, rail, link } = setup();
    pointer('pointerdown', link, 'touch');
    fixture.detectChanges();
    expect(rail.style.width).toBe('16rem');
    pointer('pointerdown', document.body, 'touch');
    fixture.detectChanges();
    expect(rail.style.width).toBe('3.5rem');
  });
});

describe('NavRail groups', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', children: [] }])] });
  });

  it('children stay in the page and animate open with the rail instead of popping in (no jump)', async () => {
    const fixture = TestBed.createComponent(NavRail);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rail = el.querySelector('nav') as HTMLElement;
    const group = el.querySelector('button[aria-expanded]') as HTMLButtonElement;
    group.click(); // open the first group (collapsed rail: this is a plain click, as with a mouse)
    fixture.detectChanges();

    const wrap = el.querySelector(`#${group.getAttribute('aria-controls')}`)!.parentElement!.parentElement as HTMLElement;
    expect(wrap.style.gridTemplateRows).toBe('0fr'); // rail collapsed: folded away, not removed
    expect(wrap.hasAttribute('inert')).toBe(true); // and out of the tab order
    expect(wrap.className).toContain('transition-[grid-template-rows,opacity]');

    rail.dispatchEvent(new Event('mouseenter')); // the rail expands
    fixture.detectChanges();
    expect(wrap.style.gridTemplateRows).toBe('1fr');
    expect(wrap.hasAttribute('inert')).toBe(false);
  });
});
