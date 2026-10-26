// Generates tokens.css (CSS custom properties) and tailwind-theme.css (Tailwind v4 theme)
// from tokens.json. Run after every token change:  node replica/design/build-tokens.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(readFileSync(join(here, 'tokens.json'), 'utf8'));
const header = '/* Generated from tokens.json by build-tokens.mjs. Do not edit by hand. */\n';
const px = (n) => (n === 0 ? '0' : `${n}px`);

// Role name in tokens.json -> Tailwind colour name (class: bg-surface, text-muted, border-input ...)
const tailwindName = {
  bg: 'canvas', surface: 'surface', 'surface-muted': 'surface-muted', border: 'border',
  'border-input': 'input', text: 'fg', 'text-muted': 'muted', accent: 'accent',
  'accent-hover': 'accent-hover', 'accent-subtle': 'accent-subtle', 'on-accent': 'on-accent',
  focus: 'focus', danger: 'danger', 'danger-subtle': 'danger-subtle', 'on-danger': 'on-danger',
  success: 'success', 'success-subtle': 'success-subtle', warning: 'warning', 'warning-subtle': 'warning-subtle',
  // The test chat screen, drawn like a phone messaging app.
  'chat-wallpaper': 'chat-wallpaper', 'chat-header': 'chat-header', 'on-chat-header': 'on-chat-header', 'chat-in': 'chat-in', 'chat-out': 'chat-out',
};
const roles = Object.keys(t.color.light);
for (const r of roles) {
  if (!(r in t.color.dark)) throw new Error(`dark palette is missing "${r}"`);
  if (!(r in tailwindName)) throw new Error(`no Tailwind name for colour role "${r}"`);
}

// Chart roles (series, grid, axis) come from the dataviz method and swap with the theme too.
const chartVars = (mode) => Object.entries(t.chart?.[mode] ?? {}).map(([k, v]) => `  --ds-chart-${k}: ${v};`);
const colorVars = (mode) => [...roles.map((r) => `  --ds-${r}: ${t.color[mode][r]};`), ...chartVars(mode)].join('\n');

const staticVars = [
  `  --ds-font-sans: ${t.font.sans};`,
  `  --ds-font-mono: ${t.font.mono};`,
  ...Object.entries(t.type).flatMap(([k, v]) => [
    `  --ds-type-${k}-size: ${px(v.size)};`,
    `  --ds-type-${k}-line: ${px(v.line)};`,
    `  --ds-type-${k}-weight: ${v.weight};`,
  ]),
  ...Object.entries(t.radius).map(([k, v]) => `  --ds-radius-${k}: ${px(v)};`),
  ...Object.entries(t.shadow).map(([k, v]) => `  --ds-shadow-${k}: ${v};`),
  `  --ds-motion-fast: ${t.motion.fast};`,
  `  --ds-motion-base: ${t.motion.base};`,
  `  --ds-ease: ${t.motion.ease};`,
  ...Object.entries(t.layout).filter(([, v]) => typeof v === 'number').map(([k, v]) => `  --ds-${k}: ${px(v)};`),
].join('\n');

const css = `${header}
:root {
  color-scheme: light;
${colorVars('light')}
${staticVars}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${colorVars('dark').replace(/^/gm, '  ')}
  }
}

/* Any element can opt into dark (the kitchen view does), not only the page root. */
[data-theme="dark"] {
  color-scheme: dark;
${colorVars('dark')}
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --ds-motion-fast: 0ms;
    --ds-motion-base: 0ms;
  }
}
`;

const bp = t.layout.breakpoints;
const theme = `${header}
/* Only token-backed values exist: the default palette and type scale are switched off,
   so components can use bg-surface / text-muted but never bg-blue-500 or text-[13px]. */
@theme inline {
  --color-*: initial;
  --color-white: #ffffff;
  --color-black: #000000;
${roles.map((r) => `  --color-${tailwindName[r]}: var(--ds-${r});`).join('\n')}

  --font-sans: var(--ds-font-sans);
  --font-mono: var(--ds-font-mono);

  --text-*: initial;
${Object.keys(t.type).map((k) => `  --text-${k}: var(--ds-type-${k}-size);
  --text-${k}--line-height: var(--ds-type-${k}-line);
  --text-${k}--font-weight: var(--ds-type-${k}-weight);`).join('\n')}

  --spacing: ${px(t.space[1])};

  --radius-*: initial;
${Object.keys(t.radius).map((k) => `  --radius-${k}: var(--ds-radius-${k});`).join('\n')}

  --shadow-*: initial;
  --shadow-card: var(--ds-shadow-card);
  --shadow-pop: var(--ds-shadow-pop);

  --ease-ds: var(--ds-ease);

${Object.entries(bp).map(([k, v]) => `  --breakpoint-${k}: ${v / 16}rem;`).join('\n')}
}
`;

writeFileSync(join(here, 'tokens.css'), css);
writeFileSync(join(here, 'tailwind-theme.css'), theme);
console.log(`wrote tokens.css (${roles.length} colour roles x 2 modes) and tailwind-theme.css`);
