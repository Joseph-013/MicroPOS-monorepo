export type TextField = HTMLInputElement | HTMLTextAreaElement;

/** Tells bindings and listeners the value changed, as typing would. */
function notify(field: TextField): void {
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Caret or selection, or null for input types that do not expose one (email, number). */
function selection(field: TextField): { start: number; end: number } | null {
  try {
    const { selectionStart: start, selectionEnd: end } = field;
    return start === null || end === null ? null : { start, end };
  } catch {
    return null;
  }
}

/** Inserts `text` at the caret (replacing any selection) and fires `input`. Respects `maxLength`. */
export function insertText(field: TextField, text: string): void {
  const range = selection(field);
  const start = range?.start ?? field.value.length;
  const end = range?.end ?? field.value.length;
  if (field.maxLength > 0 && field.value.length - (end - start) + text.length > field.maxLength) return;
  if (range) {
    field.setRangeText(text, start, end, 'end');
  } else {
    field.value += text;
  }
  notify(field);
}

/** Deletes the selection, or the character before the caret, and fires `input`. */
export function deleteBackward(field: TextField): void {
  const range = selection(field);
  if (!range) {
    if (!field.value) return;
    field.value = field.value.slice(0, -1);
  } else if (range.start !== range.end) {
    field.setRangeText('', range.start, range.end, 'end');
  } else if (range.start > 0) {
    field.setRangeText('', range.start - 1, range.start, 'end');
  } else {
    return;
  }
  notify(field);
}
