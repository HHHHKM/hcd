import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

function implementations(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return implementations(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
it('C1 keeps each frontend implementation file within 400 formatted lines', () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const oversized = implementations(root).flatMap((path) => {
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n').length;
    return lines > 400 ? [`${path.slice(root.length + 1)}: ${lines}`] : [];
  });
  expect(oversized).toEqual([]);
});
