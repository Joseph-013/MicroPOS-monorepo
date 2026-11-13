import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes)],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the logo and nav', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('svg[aria-label="MicroPOS"]')).toBeTruthy();
    expect(el.textContent).toContain('Sales Orders');
    expect(el.querySelector('a[href="/settings"]')).toBeTruthy();
    expect(el.textContent).toContain('Logout');
  });

  it('opens a nav group containing the current page and shows its children', async () => {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/items/products');
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    el.querySelector('nav')!.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();

    const group = el.querySelector('button[aria-expanded]')!;
    expect(group.getAttribute('aria-expanded')).toBe('true');
    expect(el.textContent).toContain('Products');
    expect(el.textContent).toContain('Categories');
  });

  it('toggles a nav group', async () => {
    const fixture = TestBed.createComponent(App);
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable(); // the shell renders on the first change detection
    el.querySelector('nav')!.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();

    const group = el.querySelector('button[aria-expanded]') as HTMLButtonElement;
    expect(group.getAttribute('aria-expanded')).toBe('false');
    group.click();
    await fixture.whenStable();
    expect(group.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows only the page in the customer display window: no navigation, no banner, no start-up work', async () => {
    const before = location.href;
    history.replaceState(null, '', '#/customer-display');
    try {
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('nav')).toBeNull();
      expect(el.querySelector('app-banner-host')).toBeNull();
      expect(el.querySelector('router-outlet')).not.toBeNull();
    } finally {
      history.replaceState(null, '', before);
    }
  });
});
