// Single source of truth for the MicroPOS look: the square "Industry" blueprint design,
// with backgrounds (background/popover/secondary/muted) and the accent (primary/ring/tag)
// taken from the old MicroPOS app (hue 232.418). Hex/rgba only so React Native can use it.
// Pure data: no DOM/platform imports. Web apps consume the generated theme.css
// (CSS variables); React Native consumes these objects directly.

export interface ColorTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  /** Registration marks on blueprint frames. */
  mark: string;
  tagAccentBg: string;
  tagAccentFg: string;
  tagNeutralBg: string;
  tagNeutralFg: string;
}

export const light: ColorTokens = {
  background: '#f6fbfd',
  foreground: '#1d1f20',
  card: 'transparent',
  cardForeground: '#1d1f20',
  popover: '#ffffff',
  popoverForeground: '#1d1f20',
  primary: '#005e8c',
  primaryForeground: '#fafcfd',
  secondary: '#e0ecf2',
  secondaryForeground: '#1d1f20',
  muted: '#e7f0f5',
  mutedForeground: '#5d5d60',
  accent: 'rgba(29, 31, 32, 0.07)',
  accentForeground: '#1d1f20',
  destructive: '#b3413a',
  border: 'rgba(29, 31, 32, 0.16)',
  input: 'rgba(29, 31, 32, 0.16)',
  ring: '#005e8c',
  mark: 'rgba(29, 31, 32, 0.55)',
  tagAccentBg: '#d8e7f0',
  tagAccentFg: '#005e8c',
  tagNeutralBg: '#f5f5f8',
  tagNeutralFg: '#424244',
};

export const dark: ColorTokens = {
  background: '#041d29',
  foreground: '#f2f2f3',
  card: 'transparent',
  cardForeground: '#f2f2f3',
  popover: '#122833',
  popoverForeground: '#f2f2f3',
  primary: '#dee9f0',
  primaryForeground: '#041d29',
  secondary: '#233640',
  secondaryForeground: '#f2f2f3',
  muted: '#233640',
  mutedForeground: '#b7b7ba',
  accent: 'rgba(242, 242, 243, 0.08)',
  accentForeground: '#f2f2f3',
  destructive: '#e07a72',
  border: 'rgba(242, 242, 243, 0.16)',
  input: 'rgba(242, 242, 243, 0.16)',
  ring: '#dee9f0',
  mark: 'rgba(242, 242, 243, 0.55)',
  tagAccentBg: '#233640',
  tagAccentFg: '#f4fbff',
  tagNeutralBg: '#2b2b2d',
  tagNeutralFg: '#e7e7ea',
};

export const fonts = {
  heading: '"Inter Variable", system-ui, sans-serif',
  headingWeight: '600',
  body: '"Inter Variable", system-ui, sans-serif',
} as const;

/** Blueprint objects are square-cornered. */
export const radius = '0px';

export const themes = { light, dark } as const;
export type ThemeName = keyof typeof themes;
