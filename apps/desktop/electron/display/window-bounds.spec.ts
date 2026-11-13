import { describe, expect, it } from 'vitest';
import { clampToArea, type DisplayInfo, displayOf, parsePlacement, placementOf, placementOnDisplay, resolveBounds } from './window-bounds';

/** A 1920x1080 monitor with a 40px taskbar along the bottom. */
const monitor = (id: number, x: number, y = 0, width = 1920, height = 1080): DisplayInfo => ({
  id,
  bounds: { x, y, width, height },
  workArea: { x, y, width, height: height - 40 },
});
const main = monitor(1, 0);
const customer = monitor(2, 1920);

const inside = (r: { x: number; y: number; width: number; height: number }, d: DisplayInfo): boolean =>
  r.x >= d.workArea.x && r.y >= d.workArea.y && r.x + r.width <= d.workArea.x + d.workArea.width && r.y + r.height <= d.workArea.y + d.workArea.height;

describe('clampToArea', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };

  it('leaves a window that fits where it is', () => {
    expect(clampToArea({ x: 100, y: 50, width: 800, height: 600 }, area)).toEqual({ x: 100, y: 50, width: 800, height: 600 });
  });

  it('moves a window back from every edge', () => {
    expect(clampToArea({ x: -300, y: -40, width: 800, height: 600 }, area)).toMatchObject({ x: 0, y: 0 });
    expect(clampToArea({ x: 1800, y: 900, width: 800, height: 600 }, area)).toMatchObject({ x: 1120, y: 440 });
  });

  it('shrinks a window larger than the area to the area', () => {
    expect(clampToArea({ x: 0, y: 0, width: 5000, height: 4000 }, area)).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
  });

  it('respects an area that does not start at the origin (a monitor to the left or above)', () => {
    const left = { x: -1280, y: -200, width: 1280, height: 1024 };
    expect(clampToArea({ x: 50, y: 50, width: 800, height: 600 }, left)).toEqual({ x: -800, y: 50, width: 800, height: 600 }); // x moved left of the area's edge, y already fits
  });

  it('keeps a minimum size, unless the area itself is smaller', () => {
    expect(clampToArea({ x: 0, y: 0, width: 10, height: 10 }, area)).toMatchObject({ width: 320, height: 240 });
    expect(clampToArea({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 200, height: 100 })).toMatchObject({ width: 200, height: 100 });
  });
});

describe('displayOf and placementOf', () => {
  it('picks the monitor most of the window is on', () => {
    expect(displayOf({ x: 1700, y: 100, width: 800, height: 600 }, [main, customer])?.id).toBe(2); // 620 of 800 px on the second
    expect(displayOf({ x: 1500, y: 100, width: 800, height: 600 }, [main, customer])?.id).toBe(1);
  });

  it('picks the nearest monitor for a window on none', () => {
    expect(displayOf({ x: 5000, y: 0, width: 400, height: 300 }, [main, customer])?.id).toBe(2);
    expect(displayOf({ x: -3000, y: 0, width: 400, height: 300 }, [main, customer])?.id).toBe(1);
  });

  it('remembers the position relative to the monitor', () => {
    expect(placementOf({ x: 2020, y: 80, width: 900, height: 700 }, [main, customer])).toEqual({
      displayId: 2,
      displayBounds: customer.bounds,
      x: 100,
      y: 80,
      width: 900,
      height: 700,
    });
  });
});

describe('resolveBounds', () => {
  const saved = placementOf({ x: 2020, y: 80, width: 900, height: 700 }, [main, customer])!;

  it('comes back to the same place on the same monitor', () => {
    expect(resolveBounds(saved, [main, customer], 1)).toEqual({ x: 2020, y: 80, width: 900, height: 700 });
  });

  it('follows the monitor when the arrangement changed: it is now on the left', () => {
    const left = monitor(2, -1920);
    expect(resolveBounds(saved, [left, { ...main }], 1)).toEqual({ x: -1820, y: 80, width: 900, height: 700 });
  });

  it('finds a monitor that came back under a new id by its size and position', () => {
    expect(resolveBounds(saved, [main, monitor(9, 1920)], 1)).toEqual({ x: 2020, y: 80, width: 900, height: 700 });
  });

  it('finds it by size alone when it also moved', () => {
    expect(resolveBounds(saved, [main, monitor(9, 3840)], 1)).toEqual({ x: 3940, y: 80, width: 900, height: 700 });
  });

  it('clamps when the monitor now has a smaller resolution', () => {
    const small = monitor(2, 1920, 0, 1280, 720);
    const placed = resolveBounds(saved, [main, small], 1)!;
    expect(inside(placed, small)).toBe(true);
    expect(placed).toEqual({ x: 2020, y: 0, width: 900, height: 680 });
  });

  it('clamps a window that was saved partly off its monitor', () => {
    const edge = { ...saved, x: 1700, y: 900 };
    const placed = resolveBounds(edge, [main, customer], 1)!;
    expect(placed).toEqual({ x: 2940, y: 340, width: 900, height: 700 }); // pushed back to the right edge (3840 - 900) and the bottom (1040 - 700)
    expect(inside(placed, customer)).toBe(true);
  });

  it('opens on the other monitor, centred, when its monitor is gone and another is connected', () => {
    const placed = resolveBounds(saved, [main, monitor(7, 1920, 0, 1366, 768)], 1)!;
    expect(inside(placed, monitor(7, 1920, 0, 1366, 768))).toBe(true);
    expect(placed.x).toBeGreaterThanOrEqual(1920);
  });

  it('opens centred on the only monitor when there is just one', () => {
    expect(resolveBounds(saved, [main], 1)).toEqual({ x: 448, y: 136, width: 1024, height: 768 });
    expect(resolveBounds(null, [main], 1)).toEqual({ x: 448, y: 136, width: 1024, height: 768 });
  });

  it('prefers a non-primary monitor on a first start, and shrinks the default to a small one', () => {
    expect(resolveBounds(null, [main, customer], 1)).toEqual({ x: 2368, y: 136, width: 1024, height: 768 });
    const tiny = monitor(3, 1920, 0, 800, 600);
    expect(resolveBounds(null, [main, tiny], 1)).toEqual({ x: 1920, y: 0, width: 800, height: 560 });
  });

  it('has nowhere to open without any monitor', () => {
    expect(resolveBounds(saved, [], 1)).toBeNull();
  });
});

describe('parsePlacement', () => {
  it('accepts what placementOf wrote and nothing else', () => {
    const p = placementOf({ x: 10, y: 10, width: 400, height: 300 }, [main])!;
    expect(parsePlacement(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(parsePlacement(null)).toBeNull();
    expect(parsePlacement({})).toBeNull();
    expect(parsePlacement({ ...p, width: 'wide' })).toBeNull();
    expect(parsePlacement({ ...p, displayBounds: { x: 0 } })).toBeNull();
    expect(parsePlacement({ ...p, x: NaN })).toBeNull();
  });
});

describe('placementOnDisplay (maximized or full screen: only the monitor is remembered)', () => {
  const windowed = placementOf({ x: 2020, y: 80, width: 900, height: 700 }, [main, customer])!;

  it('keeps the size and position of the ordinary window while the window covers its monitor', () => {
    // Maximized on the customer monitor: its bounds are the monitor's work area.
    expect(placementOnDisplay(windowed, customer.workArea, [main, customer])).toEqual(windowed);
  });

  it('moves the remembered window onto the monitor it was dragged to', () => {
    const placed = placementOnDisplay(windowed, main.workArea, [main, customer])!;
    expect(placed).toMatchObject({ displayId: 1, displayBounds: main.bounds, x: 100, y: 80, width: 900, height: 700 });
    expect(resolveBounds(placed, [main, customer], 1)).toEqual({ x: 100, y: 80, width: 900, height: 700 });
  });

  it('starts from the default centred window when nothing was remembered', () => {
    const placed = placementOnDisplay(null, customer.workArea, [main, customer])!;
    expect(placed.displayId).toBe(2);
    expect(resolveBounds(placed, [main, customer], 1)).toEqual({ x: 2368, y: 136, width: 1024, height: 768 });
  });

  it('has nothing to remember without a monitor', () => {
    expect(placementOnDisplay(windowed, customer.workArea, [])).toBeNull();
  });
});
