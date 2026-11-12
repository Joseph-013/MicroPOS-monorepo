import { TestBed } from '@angular/core/testing';
import { ComponentsPage } from './components';

describe('ComponentsPage context menu', () => {
  it('opens the Spartan context menu on right-click', async () => {
    const fixture = TestBed.createComponent(ComponentsPage);
    await fixture.whenStable();
    const zone = (fixture.nativeElement as HTMLElement).querySelector('#context-menu-zone')!;

    zone.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    await fixture.whenStable();

    const items = Array.from(document.querySelectorAll('[hlmDropdownMenuItem], [data-slot="dropdown-menu-item"]'));
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Open', 'Duplicate', 'Delete']);
  });
});
