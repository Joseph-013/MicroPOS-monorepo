// Generates dist/theme.css (CSS variables) from the compiled tokens.
import { writeFileSync } from 'node:fs';
import { light, dark, fonts, radius } from '../dist/index.js';

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const vars = (t) => Object.entries(t).map(([k, v]) => `  --${kebab(k)}: ${v};`).join('\n');

const css = `/* GENERATED from src/tokens.ts by scripts/generate-css.mjs. Do not edit. */
:root {
  color-scheme: light;
  --radius: ${radius};
  --font-heading: ${fonts.heading};
  --font-heading-weight: ${fonts.headingWeight};
  --font-body: ${fonts.body};
${vars(light)}
}

:root.dark {
  color-scheme: dark;
${vars(dark)}
}
`;
writeFileSync(new URL('../dist/theme.css', import.meta.url), css);
