import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SwipeActionEvent, SwipeActions, type SwipeAction } from './swipe-actions';

const del: SwipeAction = { id: 'delete', label: 'Delete', tone: 'destructive', exit: true };
const archive: SwipeAction = { id: 'archive', label: 'Archive', tone: 'warning' };
const edit: SwipeAction = { id: 'edit', label: 'Edit', tone: 'primary' };
const flag: SwipeAction = { id: 'flag', label: 'Flag', tone: 'success' };

@Component({
  imports: [SwipeActions],
  template: `
    <app-swipe-actions [swipeLeft]="left" [swipeRight]="right" (action)="events.push($event)">
      <button (click)="taps = taps + 1">row</button>
    </app-swipe-actions>
  `,
})
class Host {
  left = [del, archive];
  right = [edit, flag];
  events: SwipeActionEvent[] = [];
  taps = 0;
}

@Component({
  imports: [SwipeActions],
  template: `<app-swipe-actions [swipeLeft]="left" (action)="events.push($event)"><div>row</div></app-swipe-actions>`,
})
class LeftOnlyHost {
  left = [del];
  events: SwipeActionEvent[] = [];
}

const pe = (type: string, x: number, y = 0, pointerType = 'touch'): Event =>
  Object.assign(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }), { pointerId: 1, pointerType });

describe('SwipeActions', () => {
  let host: Host;
  let el: HTMLElement;
  let row: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<Host>>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    row = el.querySelector('app-swipe-actions > div:last-child')!;
  });
  afterEach(() => vi.useRealTimers());

  /** Drags from x=500 to `500 + dx` (negative = left), without releasing. */
  const drag = async (dx: number, y = 0): Promise<void> => {
    row.dispatchEvent(pe('pointerdown', 500));
    row.dispatchEvent(pe('pointermove', 500 + dx, y));
    await fixture.whenStable();
  };
  const release = async (dx: number): Promise<void> => {
    row.dispatchEvent(pe('pointerup', 500 + dx));
    await fixture.whenStable();
  };
  const highlighted = (): string[] => [...el.querySelectorAll('[data-highlighted]')].map((c) => c.textContent!.trim());
  const cells = (): string[] => [...el.querySelectorAll('app-swipe-actions > div:first-child > div')].map((c) => c.textContent!.trim());

  it('follows the finger and reveals the actions in the order they are reached, nearest the edge first', async () => {
    await drag(-50);
    expect(row.style.transform).toBe('translateX(-50px)');
    expect(cells()).toEqual(['Delete', 'Archive']);
    // Swiping left anchors the actions to the right edge: the first one is rightmost.
    const layer = el.querySelector('app-swipe-actions > div:first-child') as HTMLElement;
    expect(layer.className).toContain('right-0');
    expect(layer.className).toContain('flex-row-reverse');
  });

  it('highlights nothing before the first distance, then one more action per extra step', async () => {
    await drag(-79);
    expect(highlighted()).toEqual([]);

    await drag(-80); // reached the first distance: the right-most action
    expect(highlighted()).toEqual(['Delete']);

    row.dispatchEvent(pe('pointermove', 500 - 159));
    await fixture.whenStable();
    expect(highlighted()).toEqual(['Delete']);

    row.dispatchEvent(pe('pointermove', 500 - 160)); // one step further: the second from the right
    await fixture.whenStable();
    expect(highlighted()).toEqual(['Archive']);

    row.dispatchEvent(pe('pointermove', 500 - 700)); // keep going: the last stays highlighted, the row stops
    await fixture.whenStable();
    expect(highlighted()).toEqual(['Archive']);
    expect(row.style.transform).toBe('translateX(-240px)'); // distance + 2 steps
  });

  it('colors the revealed area with the highlighted action, and neutral before any is highlighted', async () => {
    const layer = () => el.querySelector('app-swipe-actions > div:first-child') as HTMLElement;
    await drag(-40);
    expect(layer().className).toContain('bg-muted');
    row.dispatchEvent(pe('pointermove', 500 - 80));
    await fixture.whenStable();
    expect(layer().className).toContain('bg-destructive');
    row.dispatchEvent(pe('pointermove', 500 - 160));
    await fixture.whenStable();
    expect(layer().className).toContain('bg-warning');
  });

  it('runs the highlighted action on release (the second one after a longer swipe) and springs back', async () => {
    await drag(-170);
    expect(host.events).toEqual([]); // nothing until release
    await release(-170);
    expect(host.events).toEqual([{ action: archive, side: 'left' }]);
    expect(row.style.transform).toBe('translateX(0px)');
  });

  it('works the same way to the right, with its own actions, leftmost first', async () => {
    await drag(90);
    expect(highlighted()).toEqual(['Edit']);
    expect((el.querySelector('app-swipe-actions > div:first-child') as HTMLElement).className).toContain('left-0');
    row.dispatchEvent(pe('pointermove', 500 + 165));
    await fixture.whenStable();
    expect(highlighted()).toEqual(['Flag']);
    await release(165);
    expect(host.events).toEqual([{ action: flag, side: 'right' }]);
  });

  it('does nothing when released before the first distance', async () => {
    await drag(-60);
    await release(-60);
    expect(host.events).toEqual([]);
    expect(row.style.transform).toBe('translateX(0px)');
  });

  it('slides the row out first for an action marked exit, then runs it', async () => {
    await drag(-100); // Delete is the exit action
    vi.useFakeTimers();
    row.dispatchEvent(pe('pointerup', 500 - 100));
    fixture.detectChanges(); // apply the new offset to the DOM now (timers are faked)
    expect(Number(/-?\d+/.exec(row.style.transform)![0])).toBeLessThanOrEqual(-400); // sliding away
    expect(host.events).toEqual([]);
    vi.advanceTimersByTime(150);
    expect(host.events).toEqual([{ action: del, side: 'left' }]);
  });

  it('ignores a swipe toward a side that has no actions', async () => {
    const one = TestBed.createComponent(LeftOnlyHost);
    await one.whenStable();
    const oneRow = (one.nativeElement as HTMLElement).querySelector('app-swipe-actions > div:last-child') as HTMLElement;
    oneRow.dispatchEvent(pe('pointerdown', 500));
    oneRow.dispatchEvent(pe('pointermove', 620)); // to the right: there is nothing there
    oneRow.dispatchEvent(pe('pointerup', 620));
    await one.whenStable();
    expect(oneRow.style.transform).toBe('translateX(0px)');
    expect(one.componentInstance.events).toEqual([]);
  });

  it('ignores the mouse and vertical drags, which are scrolling', async () => {
    row.dispatchEvent(pe('pointerdown', 500, 0, 'mouse'));
    row.dispatchEvent(pe('pointermove', 300, 0, 'mouse'));
    row.dispatchEvent(pe('pointerup', 300, 0, 'mouse'));
    await fixture.whenStable();
    expect(host.events).toEqual([]);

    await drag(-30, 200); // mostly vertical
    await release(-30);
    expect(host.events).toEqual([]);
    expect(row.style.transform).toBe('translateX(0px)');
  });

  it('does not tap a button a swipe started on, but taps normally afterwards', async () => {
    const button = el.querySelector('button')!;
    await drag(-100);
    await release(-100);
    button.click(); // the click a browser fires after a drag
    expect(host.taps).toBe(0);

    row.dispatchEvent(pe('pointerdown', 500));
    row.dispatchEvent(pe('pointerup', 500));
    button.click();
    expect(host.taps).toBe(1);
  });
});
