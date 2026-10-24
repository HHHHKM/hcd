import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

const root = 'packages/web/src';
function styles(directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? styles(path) : path.endsWith('.css') ? [path] : [];
  });
}

it('C4 centralizes component colors and font sizes in accessible light and dark design tokens', () => {
  const failures: string[] = [];
  for (const file of styles().filter((path) => !path.endsWith('/tokens.css'))) {
    const css = readFileSync(file, 'utf8');
    if (/#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(css)) failures.push(`${file}: literal color`);
    if (/font(?:-size)?\s*:[^;{}]*\b[\d.]+(?:px|rem|em)\b/i.test(css)) failures.push(`${file}: literal font size`);
  }
  expect(failures).toEqual([]);
  const tokens = readFileSync(join(root, 'tokens.css'), 'utf8');
  const sizes = [...tokens.matchAll(/--font-size-[\w-]+\s*:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
  expect(sizes.length).toBeGreaterThan(3);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  expect(tokens).toContain('prefers-color-scheme: dark');
  expect(execFileSync(process.execPath, ['scripts/check-contrast.mjs'], { encoding: 'utf8' })).toContain('WCAG AA');
});

it('C7 keeps guest quote emphasis on the exact text without a paragraph outline', () => {
  const css = readFileSync(join(root, 'sharing.css'), 'utf8');
  const active = css.match(/\.shared-page\s+\[data-hcd-location-active\]\s*\{([^}]*)\}/)?.[1] ?? '';
  expect(active).not.toMatch(/outline\s*:\s*(?!none|0)[^;]+/);
  const highlight = readFileSync(join(root, 'anchor-text.css'), 'utf8');
  expect(highlight).toContain('.hcd-anchor-highlight');
  expect(highlight).toContain('box-decoration-break: clone');
});
