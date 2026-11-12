import { deleteBackward, insertText } from './input-editing';

function field(value: string, start: number, end = start, type = 'text'): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  document.body.appendChild(input);
  input.value = value;
  try {
    input.setSelectionRange(start, end);
  } catch {
    // email and number fields have no selection API
  }
  return input;
}

describe('input editing', () => {
  afterEach(() => (document.body.innerHTML = ''));

  it('inserts at the caret, moves the caret after the text, and fires input', () => {
    const input = field('helo', 3);
    const seen: string[] = [];
    input.addEventListener('input', () => seen.push(input.value));
    insertText(input, 'l');
    expect(input.value).toBe('hello');
    expect(input.selectionStart).toBe(4);
    expect(seen).toEqual(['hello']);
  });

  it('replaces a selection', () => {
    const input = field('hello world', 6, 11);
    insertText(input, 'there');
    expect(input.value).toBe('hello there');
  });

  it('works in a textarea, including new lines', () => {
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    area.value = 'ab';
    area.setSelectionRange(1, 1);
    insertText(area, '\n');
    expect(area.value).toBe('a\nb');
  });

  it('respects maxLength', () => {
    const input = field('abc', 3);
    input.maxLength = 3;
    insertText(input, 'd');
    expect(input.value).toBe('abc');
    input.setSelectionRange(1, 2); // replacing one character with one is fine
    insertText(input, 'x');
    expect(input.value).toBe('axc');
  });

  it('appends for input types that have no caret (email)', () => {
    const input = field('a@b', 0, 0, 'email');
    expect(input.selectionStart).toBeNull(); // the browser gives no caret for email fields
    insertText(input, '.');
    expect(input.value).toBe('a@b.');
    deleteBackward(input);
    expect(input.value).toBe('a@b');
  });

  it('deletes the character before the caret, or the selection', () => {
    const input = field('hello', 3);
    deleteBackward(input);
    expect(input.value).toBe('helo');
    expect(input.selectionStart).toBe(2);

    input.setSelectionRange(0, 2);
    deleteBackward(input);
    expect(input.value).toBe('lo');
  });

  it('does nothing, and fires nothing, when there is nothing to delete', () => {
    const input = field('abc', 0);
    let fired = 0;
    input.addEventListener('input', () => fired++);
    deleteBackward(input);
    expect(input.value).toBe('abc');
    expect(fired).toBe(0);
  });
});
