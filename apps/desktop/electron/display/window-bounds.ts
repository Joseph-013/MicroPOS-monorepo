/** Where a window is and how big, in device-independent pixels (what Electron reports and accepts). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A monitor: its full bounds, and the part not covered by taskbars and docks. */
export interface DisplayInfo {
  id: number;
  bounds: Rect;
  workArea: Rect;
}

/**
 * A window's place, remembered relative to the monitor it was on, so it comes back to the same spot even if the
 * monitors were rearranged (their origins moved) in between. `displayBounds` identifies the monitor again when
 * Windows or the driver hands it a new id.
 */
export interface Placement extends Rect {
  displayId: number;
  displayBounds: Rect;
}

/** The smallest the window may be made. */
export const MIN_SIZE = { width: 320, height: 240 };
export const DEFAULT_SIZE = { width: 1024, height: 768 };

const overlap = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

const sameSize = (a: Rect, b: Rect): boolean => a.width === b.width && a.height === b.height;
const sameRect = (a: Rect, b: Rect): boolean => sameSize(a, b) && a.x === b.x && a.y === b.y;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Keeps a window inside a monitor's usable area: it is made no larger than the area (but not below the minimum, unless
 * the area itself is smaller) and moved so that no edge is outside it.
 */
export function clampToArea(rect: Rect, area: Rect): Rect {
  const width = Math.max(1, Math.min(Math.max(rect.width, MIN_SIZE.width), area.width));
  const height = Math.max(1, Math.min(Math.max(rect.height, MIN_SIZE.height), area.height));
  const x = Math.min(Math.max(rect.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(rect.y, area.y), area.y + area.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** The monitor most of the window is on (the nearest one when it is on none). */
export function displayOf(bounds: Rect, displays: DisplayInfo[]): DisplayInfo | undefined {
  let best: DisplayInfo | undefined;
  let bestOverlap = 0;
  for (const display of displays) {
    const o = overlap(bounds, display.bounds);
    if (o > bestOverlap) {
      best = display;
      bestOverlap = o;
    }
  }
  if (best) return best;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const distance = (d: DisplayInfo): number => {
    const dx = Math.max(d.bounds.x - cx, 0, cx - (d.bounds.x + d.bounds.width));
    const dy = Math.max(d.bounds.y - cy, 0, cy - (d.bounds.y + d.bounds.height));
    return dx * dx + dy * dy;
  };
  return [...displays].sort((a, b) => distance(a) - distance(b))[0];
}

/** The placement to remember for a window now: its monitor, and its bounds relative to that monitor. */
export function placementOf(bounds: Rect, displays: DisplayInfo[]): Placement | null {
  const display = displayOf(bounds, displays);
  if (!display) return null;
  return {
    displayId: display.id,
    displayBounds: { ...display.bounds },
    x: bounds.x - display.bounds.x,
    y: bounds.y - display.bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

/** Checks something read from disk; anything not a placement is dropped. */
export function parsePlacement(value: unknown): Placement | null {
  const v = (value ?? {}) as Record<string, unknown>;
  const b = (v['displayBounds'] ?? {}) as Record<string, unknown>;
  if (![v['displayId'], v['x'], v['y'], v['width'], v['height'], b['x'], b['y'], b['width'], b['height']].every(finite)) return null;
  return {
    displayId: v['displayId'] as number,
    x: v['x'] as number,
    y: v['y'] as number,
    width: v['width'] as number,
    height: v['height'] as number,
    displayBounds: { x: b['x'] as number, y: b['y'] as number, width: b['width'] as number, height: b['height'] as number },
  };
}

/**
 * Where to open the window. With a remembered placement: on the same monitor (by id; else the monitor that looks the
 * same, by position and size, then by size alone), at the same place on it. With none, or when that monitor is no
 * longer connected: on a monitor other than the primary one when there is one (the customer's), else the primary,
 * centred at the default size. Either way the result is clamped inside that monitor's usable area, so it is never
 * off screen however the monitors changed.
 */
export function resolveBounds(saved: Placement | null, displays: DisplayInfo[], primaryId: number): Rect | null {
  if (displays.length === 0) return null;
  const primary = displays.find((d) => d.id === primaryId) ?? displays[0]!;

  if (saved) {
    const same =
      displays.find((d) => d.id === saved.displayId) ??
      displays.find((d) => sameRect(d.bounds, saved.displayBounds)) ??
      displays.find((d) => sameSize(d.bounds, saved.displayBounds) && d.id !== primary.id);
    if (same) {
      return clampToArea({ x: same.bounds.x + saved.x, y: same.bounds.y + saved.y, width: saved.width, height: saved.height }, same.workArea);
    }
  }

  const target = displays.find((d) => d.id !== primary.id) ?? primary;
  const area = target.workArea;
  const width = Math.min(DEFAULT_SIZE.width, area.width);
  const height = Math.min(DEFAULT_SIZE.height, area.height);
  return clampToArea({ x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height }, area);
}
