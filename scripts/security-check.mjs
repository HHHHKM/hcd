import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const errors = [];
async function visit(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, item.name);
    if (item.isDirectory()) await visit(file);
    else if (/\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.test.ts')) {
      const text = await readFile(file, 'utf8');
      if (/dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\s*\(|new\s+Function\s*\(/.test(text)) errors.push(file);
    }
  }
}
await visit('packages/web/src');
if (errors.length) { console.error('Unsafe rendering API in:', ...errors); process.exit(1); }
console.log('Security scan: no unsafe HTML rendering or eval in web source.');
