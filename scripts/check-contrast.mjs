import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../packages/web/src/tokens.css', import.meta.url), 'utf8');
const parse = (block) =>
  Object.fromEntries([...block.matchAll(/--([\w-]+)\s*:\s*(#[\da-f]+)\s*;/gi)].map((m) => [m[1], m[2]]));
const themes = {
  light: parse(css.match(/:root\s*\{([^}]+)\}/)[1]),
  dark: parse(css.match(/:root\[data-theme=['"]dark['"]\][^{]*\{([^}]+)\}/)[1]),
};
const pairs = [
  ['ink', 'paper'],
  ['ink', 'warm-paper'],
  ['ink', 'surface'],
  ['ink', 'surface-raised'],
  ['muted-ink', 'paper'],
  ['muted-ink', 'warm-paper'],
  ['muted-ink', 'surface-raised'],
  ['faint-ink', 'paper'],
  ['faint-ink', 'warm-paper'],
  ['faint-ink', 'surface-raised'],
  ['danger', 'danger-surface'],
  ['danger', 'paper'],
  ['success', 'success-surface'],
  ['success', 'paper'],
  ['warning', 'warning-surface'],
  ['warning', 'paper'],
  ['info', 'info-surface'],
  ['info', 'paper'],
  ['on-dark', 'dark'],
  ['muted-on-dark', 'dark-2'],
  ['accent', 'paper'],
  ['highlight-text', 'highlight'],
  ...['coral', 'blue', 'green', 'violet', 'gold'].map((name) => ['avatar-ink', `avatar-${name}`]),
];
function luminance(hex) {
  let value = hex.slice(1);
  if (value.length === 3)
    value = value
      .split('')
      .map((x) => x + x)
      .join('');
  const rgb = [0, 2, 4]
    .map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
const failures = [];
for (const [theme, tokens] of Object.entries(themes)) {
  for (const [foreground, background] of pairs) {
    if (!tokens[foreground] || !tokens[background]) throw new Error(`Missing ${theme} contrast token`);
    const a = luminance(tokens[foreground]);
    const b = luminance(tokens[background]);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 4.5) failures.push(`${theme}: ${foreground}/${background} = ${ratio.toFixed(2)}:1`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`WCAG AA: ${pairs.length} text/background pairs passed in both light and dark themes.`);
