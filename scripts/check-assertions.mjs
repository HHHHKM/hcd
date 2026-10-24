import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// Usage: node scripts/check-assertions.mjs <extracted-baseline-tests-or-source-directory>
const base = resolve(import.meta.dirname, '..');
const baselineRoot = process.argv[2];
if (!baselineRoot) throw new Error('Pass the original extracted baseline test directory.');
const require = createRequire(join(base, 'package.json'));
const ts = require('typescript');
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((f) =>
    f.isDirectory() ? walk(join(dir, f.name)) : /\.[jt]sx?$/.test(f.name) ? [join(dir, f.name)] : [],
  );
}
function isExpect(call) {
  let n = call.expression;
  while (n) {
    if (ts.isIdentifier(n)) return n.text === 'expect';
    if (ts.isCallExpression(n) || ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) n = n.expression;
    else return false;
  }
  return false;
}
function normalize(node) {
  if (ts.isParenthesizedExpression(node)) return normalize(node.expression);
  const children = [];
  ts.forEachChild(node, (child) => {
    children.push(normalize(child));
  });
  return JSON.stringify([node.kind, 'text' in node ? node.text : null, children]);
}
function collect(files) {
  const result = new Map();
  for (const path of files) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        isExpect(node) &&
        !ts.isPropertyAccessExpression(node.parent) &&
        !ts.isElementAccessExpression(node.parent)
      ) {
        const key = normalize(node);
        const rows = result.get(key) ?? [];
        rows.push(path);
        result.set(key, rows);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return result;
}
const old = collect(walk(resolve(baselineRoot)));
const current = collect(walk(join(base, 'packages')));
const missing = [];
let baselineAssertions = 0,
  currentAssertions = 0;
for (const v of current.values()) currentAssertions += v.length;
for (const [key, paths] of old) {
  baselineAssertions += paths.length;
  const found = current.get(key)?.length ?? 0;
  if (found < paths.length) missing.push({ assertion: key, missing: paths.length - found, originalFiles: paths });
}
const result = {
  baseline: 'hcd-ai-test-20261023-550',
  baselineAssertions,
  currentAssertions,
  unmatched: missing.length,
  missing,
};
writeFileSync(join(base, 'outputs/assertion-integrity.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ baselineAssertions, currentAssertions, unmatched: missing.length }));
if (missing.length) process.exitCode = 1;
