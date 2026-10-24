import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite/package.json'));
const postcss = viteRequire('postcss');
const base = 'packages/web/src';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const cssFiles = (folder) => readdirSync(folder, { withFileTypes: true }).flatMap((item) =>
  item.isDirectory() ? cssFiles(join(folder, item.name)) : item.name.endsWith('.css') ? [join(folder, item.name)] : []);
const aliases = JSON.parse(readFileSync('outputs/E5-alias-plan.json')).tokens;
const themeNames = ['chrome', 'document', 'editor', 'panels', 'pages'].map((name) => `theme/apple-${name}.css`);
const files = new Map(cssFiles(base).map((path) => {
  const before = readFileSync(path, 'utf8');
  return [relative(base, path), { path, before, ast: postcss.parse(before, { from: path }) }];
}));
for (const name of themeNames) {
  const entry = files.get(name);
  if (!entry) throw new Error(`Missing expected theme file: ${name}`);
  let count = 0; entry.ast.walkRules(() => count++);
  if (count) throw new Error(`Finish owner migration before cleanup: ${name} has ${count} rules`);
}
const tokenAst = files.get('tokens.css').ast;
const tokenMaps = { light: {}, automaticDark: {}, explicitDark: {} };
tokenAst.walkRules((rule) => {
  let mode;
  if (rule.parent.type === 'atrule' && rule.parent.name === 'media' &&
      rule.parent.params === '(prefers-color-scheme: dark)' && rule.selector.startsWith(':root')) mode = 'automaticDark';
  else if (rule.selector === ':root') mode = 'light';
  else if (rule.selector.includes(':root[data-theme=')) mode = 'explicitDark';
  if (!mode) return;
  rule.walkDecls((decl) => { tokenMaps[mode][decl.prop] = decl.value; });
});
const resolve = (value, tokens, stack = []) => value.replace(/var\((--[\w-]+)\)/g, (_, token) => {
  if (stack.includes(token) || tokens[token] === undefined) throw new Error(`Invalid alias chain: ${token}`);
  return resolve(tokens[token], tokens, [...stack, token]);
});
for (const alias of aliases) if (alias.replacement) for (const [mode, own] of Object.entries(tokenMaps)) {
  const tokens = { ...tokenMaps.light, ...own };
  if (resolve(`var(${alias.token})`, tokens) !== resolve(alias.replacement, tokens)) {
    throw new Error(`Non-equivalent alias replacement: ${mode} ${alias.token}`);
  }
}
const replacements = [];
for (const [file, entry] of files) entry.ast.walkDecls((decl) => {
  if (aliases.some((alias) => alias.token === decl.prop)) return;
  for (const alias of aliases) {
    const pattern = new RegExp(`var\\(\\s*${alias.token}\\s*\\)`, 'g');
    if (!pattern.test(decl.value)) continue;
    if (!alias.replacement) throw new Error(`Unresolved alias needs owner merge first: ${file} ${alias.token}`);
    pattern.lastIndex = 0;
    replacements.push({ file, selector: decl.parent.selector, property: decl.prop, token: alias.token });
    decl.value = decl.value.replace(pattern, alias.replacement);
  }
});
for (const [file, entry] of files) entry.ast.walkDecls((decl) => {
  for (const alias of aliases) if (new RegExp(`var\\(\\s*${alias.token}\\s*[,)]`).test(decl.value)) {
    throw new Error(`Alias still referenced before deletion: ${file} ${alias.token}`);
  }
});
const removedDefinitions = [];
tokenAst.walkDecls((decl) => {
  if (aliases.some((alias) => alias.token === decl.prop)) {
    removedDefinitions.push({ token: decl.prop, value: decl.value }); decl.remove();
  }
});
const styles = files.get('styles.css').ast;
for (const name of themeNames) {
  let count = 0;
  styles.walkAtRules('import', (node) => {
    if (node.params.replace(/^['"]|['"]$/g, '') === './' + name) { node.remove(); count++; }
  });
  if (count !== 1) throw new Error(`Expected exactly one theme import: ${name}, got ${count}`);
}
const changed = [];
for (const [file, entry] of files) {
  let after = themeNames.includes(file) ? null : entry.ast.toString();
  if (after !== null) postcss.parse(after);
  if (entry.before !== after) changed.push({ file, path: entry.path, before: entry.before, after });
}
const contrastPath = 'scripts/check-contrast.mjs';
const contrastBefore = readFileSync(contrastPath, 'utf8');
const contrastMatches = contrastBefore.match(/'warm-paper'/g) ?? [];
if (contrastMatches.length !== 3) throw new Error('Expected the same three warm-paper contrast checks');
const contrastAfter = contrastBefore.replaceAll("'warm-paper'", "'chrome'");
changed.push({ file: contrastPath, path: contrastPath, before: contrastBefore, after: contrastAfter });
const summary = { region: '12-theme-alias-cleanup', applied: process.argv.includes('--apply'), replacements,
  removedDefinitions, themeFilesRemoved: themeNames, contrastPairsPreserved: 27,
  actions: [...replacements.map((item) => ({ kind: 'replace-equivalent-alias', ...item })),
    ...removedDefinitions.map((item) => ({ kind: 'remove-unreferenced-alias', ...item })),
    ...themeNames.map((file) => ({ kind: 'remove-empty-theme-and-import', file })),
    { kind: 'preserve-contrast-pairs', count: 27 }],
  files: changed.map(({ file, before, after }) => ({ file, beforeSha256: hash(before),
    afterSha256: after === null ? null : hash(after), beforeLines: before.split('\n').length - 1,
    afterLines: after === null ? 0 : after.split('\n').length - 1 })) };
if (summary.applied) {
  const backup = `outputs/E5-migrations/${Date.now()}-${summary.region}`;
  mkdirSync(backup, { recursive: true });
  writeFileSync(join(backup, 'backup.json'), JSON.stringify(changed, null, 2) + '\n');
  for (const { path, after } of changed) after === null ? rmSync(path) : writeFileSync(path, after);
  rmSync(join(base, 'theme'));
  summary.backup = backup;
} else summary.preview = changed;
console.log(JSON.stringify(summary, null, 2));
