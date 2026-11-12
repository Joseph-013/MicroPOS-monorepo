import { RowSelection } from './row-selection';

const ROWS = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
const none = { shiftKey: false, ctrlKey: false, metaKey: false };
const shift = { ...none, shiftKey: true };
const ctrl = { ...none, ctrlKey: true };

describe('RowSelection', () => {
  const make = () => new RowSelection(() => ROWS);
  const ids = (s: RowSelection<{ id: string }>): string[] => [...s.ids()].sort();

  it('a plain click is not a selection gesture (the page opens the row)', () => {
    const s = make();
    expect(s.click('b', none)).toBe(false);
    expect(ids(s)).toEqual([]);
  });

  it('Ctrl or Cmd + click toggles one row and leaves the others', () => {
    const s = make();
    expect(s.click('b', ctrl)).toBe(true);
    s.click('d', { ...none, metaKey: true });
    expect(ids(s)).toEqual(['b', 'd']);
    s.click('b', ctrl);
    expect(ids(s)).toEqual(['d']);
  });

  it('Shift + click selects the range from the last clicked row, in either direction, replacing the selection', () => {
    const s = make();
    s.click('b', ctrl); // anchor
    s.click('d', shift);
    expect(ids(s)).toEqual(['b', 'c', 'd']);
    s.click('a', shift); // the anchor stays on b: the range is now a..b
    expect(ids(s)).toEqual(['a', 'b']);
  });

  it('Ctrl + Shift + click adds the range to what is already selected', () => {
    const s = make();
    s.click('a', ctrl);
    s.click('c', ctrl);
    s.click('e', { ...shift, ctrlKey: true }); // anchor is c: c..e added
    expect(ids(s)).toEqual(['a', 'c', 'd', 'e']);
  });

  it('Shift + click with no anchor selects just that row', () => {
    const s = make();
    s.click('c', shift);
    expect(ids(s)).toEqual(['c']);
  });

  it('checkboxes: a plain tick toggles one row and sets the anchor; Shift + tick ticks the whole range', () => {
    const s = make();
    s.toggle('b', true);
    s.noteModifiers(shift);
    s.toggle('d', true);
    expect(ids(s)).toEqual(['b', 'c', 'd']);
    s.noteModifiers(shift);
    s.toggle('c', false); // Shift + untick clears the range back to the anchor
    expect(ids(s)).toEqual(['d']);
    s.toggle('e', true); // the modifier was used up: a plain tick
    expect(ids(s)).toEqual(['d', 'e']);
  });

  it('select all, clear and remove', () => {
    const s = make();
    s.selectAll(true);
    expect(ids(s)).toHaveLength(5);
    s.remove(['a', 'b']);
    expect(ids(s)).toEqual(['c', 'd', 'e']);
    s.clear();
    expect(ids(s)).toEqual([]);
  });

  it('ranges follow the rows on the page: an anchor that is no longer there selects only the clicked row', () => {
    let rows = ROWS;
    const s = new RowSelection(() => rows);
    s.click('a', ctrl);
    rows = ROWS.slice(2); // next page
    s.click('d', shift);
    expect(ids(s)).toEqual(['d']);
  });
});
