/** How long a pressed key keeps its color (long enough to see on a fingertip tap, short enough not to lag behind typing). */
export const KEY_FLASH_MS = 140;

/**
 * Gives a key a brief color shift when it is pressed, so a finger on a touch screen can tell the tap registered. Put it on
 * the keyboard's `(pointerdown)`: it finds the button under the finger and marks it `data-pressed` for `KEY_FLASH_MS`
 * (the style is `.key-flash` in styles.css).
 */
export function flashKey(event: Event): void {
  const key = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button');
  if (!key || key.disabled) return;
  key.setAttribute('data-pressed', '');
  setTimeout(() => key.removeAttribute('data-pressed'), KEY_FLASH_MS);
}
