#!/usr/bin/env node
// E5 tool: explicit, one-region PostCSS edits. No dependency installation or test changes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite/package.json'));
const postcss = viteRequire('postcss');
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cssRoot = join(sourceRoot, 'packages/web/src');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const normalize = (text) => text.trim().replace(/\s+/g, ' ');
const members = (rule) => postcss.list.comma(rule.selector).map(normalize);
const declarationHash = (rule) => sha(rule.nodes.filter((node) => node.type === 'decl')
  .map((node) => `${node.prop}:${node.value}:${node.important ? 'important' : ''}`).join('\n'));
const context = (rule) => {
  const result = [];
  for (let parent = rule.parent; parent?.type !== 'root'; parent = parent.parent) {
    if (parent.type !== 'atrule') throw new Error('Nested selector needs manual review');
    result.unshift(`@${parent.name} ${normalize(parent.params)}`.trim());
  }
  return result;
};
const sameContext = (rule, at = []) => JSON.stringify(context(rule)) === JSON.stringify(at);
const safePath = (file) => {
  const path = resolve(cssRoot, file);
  if (!path.startsWith(`${cssRoot}${sep}`) || !path.endsWith('.css')) {
    throw new Error(`Only existing web CSS is allowed: ${file}`);
  }
  if (!existsSync(path)) throw new Error(`Missing CSS: ${file}`);
  return path;
};
const listCss = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? listCss(path) : path.endsWith('.css') ? [path] : [];
});

function inventory() {
  const allFiles = listCss(cssRoot);
  const files = allFiles.filter((path) => !path.endsWith('/tokens.css'));
  const parsed = files.map((path) => ({
    file: relative(cssRoot, path),
    root: postcss.parse(readFileSync(path, 'utf8'), { from: path }),
  }));
  const themes = [];
  for (const source of parsed.filter(({ file }) => file.startsWith('theme/'))) {
    source.root.walkRules((rule) => {
      const selectors = members(rule);
      themes.push({ file: source.file, line: rule.source.start.line, at: context(rule), selectors,
        declarationSha256: declarationHash(rule),
        declarations: rule.nodes.filter((node) => node.type === 'decl').map((node) => `${node.prop}: ${node.value}`),
        candidates: selectors.flatMap((selector) => {
          const plain = selector.replace(/^html\s+/, '');
          return parsed.filter(({ file }) => !file.startsWith('theme/')).flatMap((target) => {
            const matches = [];
            target.root.walkRules((original) => {
              if (members(original).includes(plain)) matches.push({
                selector, plain, file: target.file, line: original.source.start.line, at: context(original),
              });
            });
            return matches;
          });
        }),
      });
    });
  }
  return { dependency: viteRequire.resolve('postcss'),
    cssLinesIncludingTokens: allFiles.reduce((sum, path) =>
      sum + readFileSync(path, 'utf8').split('\n').length - 1, 0),
    sha256: Object.fromEntries(allFiles.map((path) =>
      [relative(cssRoot, path), sha(readFileSync(path, 'utf8'))])), themes };
}

const resetGroups = {
  background: /^background(?:-|$)/,
  margin: /^margin(?:-(?:top|right|bottom|left))?$/,
  padding: /^padding(?:-(?:top|right|bottom|left))?$/,
  border: /^border(?:-(?:top|right|bottom|left|width|style|color|image)(?:-|$)|$)/,
  'border-radius': /^border-(?:(?:top|bottom)-(?:left|right)-)?radius$/,
  'border-color': /^border-(?:(?:top|right|bottom|left)-)?color$/,
  'border-style': /^border-(?:(?:top|right|bottom|left)-)?style$/,
  'border-width': /^border-(?:(?:top|right|bottom|left)-)?width$/,
  gap: /^(?:gap|row-gap|column-gap)$/,
  overflow: /^overflow(?:-[xy])?$/,
  transition: /^transition(?:-|$)/,
  animation: /^animation(?:-|$)/,
};

function migrate(manifest, apply) {
  if (!manifest.region || !Array.isArray(manifest.operations) || !manifest.operations.length) {
    throw new Error('Manifest needs one named region and explicit operations');
  }
  if (manifest.region.includes('/') || manifest.region.includes('..')) throw new Error('Invalid region');
  const files = new Map();
  const get = (file) => {
    if (!files.has(file)) {
      const path = safePath(file);
      const before = readFileSync(path, 'utf8');
      const expected = manifest.sha256?.[file];
      if (expected && expected !== sha(before)) throw new Error(`File changed since review: ${file}`);
      files.set(file, { path, before, root: postcss.parse(before, { from: path }) });
    }
    return files.get(file).root;
  };
  const locate = (ref) => {
    const matches = [];
    get(ref.file).walkRules((rule) => {
      if (sameContext(rule, ref.at) && members(rule).includes(normalize(ref.selector)) &&
          (!ref.declarationSha256 || declarationHash(rule) === ref.declarationSha256)) matches.push(rule);
    });
    if (ref.occurrence !== undefined) {
      if (!matches[ref.occurrence]) throw new Error(`Missing occurrence: ${JSON.stringify(ref)}`);
      return matches[ref.occurrence];
    }
    if (matches.length !== 1) throw new Error(`Expected one rule, got ${matches.length}: ${JSON.stringify(ref)}`);
    return matches[0];
  };
  const splitMember = (rule, selector) => {
    const selected = normalize(selector);
    const rest = members(rule).filter((member) => member !== selected);
    if (!rest.length) return rule;
    const isolated = rule.clone({ selector: selected });
    rule.selector = rest.join(',\n');
    rule.after(isolated);
    return isolated;
  };
  const consume = (rule, selector) => {
    const rest = members(rule).filter((member) => member !== normalize(selector));
    if (rest.length) rule.selector = rest.join(',\n');
    else rule.remove();
  };
  const actions = [];
  for (const operation of manifest.operations) {
    if (!operation.reason) throw new Error('Each operation needs its review rationale');
    if (operation.kind === 'merge') {
      if (!operation.from.file.startsWith('theme/')) throw new Error('Merge source must be the theme');
      if (operation.into.file === 'styles.css' || operation.into.file.startsWith('theme/')) {
        throw new Error('Merge target must be owner CSS, never styles.css or another theme');
      }
      if (/^html\s/.test(operation.into.selector)) throw new Error('Do not retain html prefix');
      const original = locate(operation.from);
      if (JSON.stringify(context(original)) !== JSON.stringify(operation.into.at ?? [])) {
        throw new Error('A merge must preserve its exact media/supports context');
      }
      if (original.nodes.some((node) => !['decl', 'comment'].includes(node.type))) {
        throw new Error('Nested theme rule needs manual review');
      }
      let target;
      if (operation.createContextAfter) {
        if (!operation.reason.includes('new state')) throw new Error('Creating a context needs a new state rationale');
        let anchor;
        if (operation.createContextAfter.atRule) {
          const ref = operation.createContextAfter.atRule;
          const matches = get(operation.into.file).nodes.filter((node) =>
            node.type === 'atrule' && node.name === ref.name && node.params === ref.params);
          if (ref.occurrence !== undefined) anchor = matches[ref.occurrence];
          else if (matches.length === 1) anchor = matches[0];
          if (!anchor) throw new Error(`Expected an explicit root at-rule anchor: ${JSON.stringify(ref)}`);
        } else anchor = locate({ ...operation.createContextAfter, file: operation.into.file });
        if (anchor.parent.type !== 'root') throw new Error('New context must follow a top-level owner anchor');
        target = postcss.rule({ selector: operation.into.selector });
        let inserted = target;
        for (let parent = original.parent; parent.type !== 'root'; parent = parent.parent) {
          const container = postcss.atRule({ name: parent.name, params: parent.params });
          container.append(inserted);
          inserted = container;
        }
        anchor.after(inserted);
      } else if (operation.createAfter) {
        if (!operation.reason.includes('new state')) throw new Error('Creating a rule needs a new state rationale');
        const anchor = locate({ ...operation.createAfter, file: operation.into.file });
        if (JSON.stringify(context(anchor)) !== JSON.stringify(operation.into.at ?? [])) {
          throw new Error('New rule must share its explicit anchor context');
        }
        target = postcss.rule({ selector: operation.into.selector });
        anchor.after(target);
      } else target = splitMember(locate(operation.into), operation.into.selector);
      const declarations = original.nodes.filter((node) => node.type === 'decl');
      const replaced = new Set(declarations.map((node) => node.prop));
      const resets = declarations.map((node) => resetGroups[node.prop]).filter(Boolean);
      target.walkDecls((declaration) => {
        if (replaced.has(declaration.prop) || resets.some((pattern) => pattern.test(declaration.prop)) ||
            operation.dropTargetProperties?.includes(declaration.prop)) declaration.remove();
      });
      target.append(declarations.map((node) => node.clone()));
      if (operation.selectorAfter) {
        if (/^html\s/.test(operation.selectorAfter)) throw new Error('Do not retain html prefix');
        target.selector = operation.selectorAfter;
      }
      if (operation.consume !== false) consume(original, operation.from.selector);
      actions.push({ kind: 'merge', from: operation.from, into: operation.into, declarations: declarations.length });
    } else if (operation.kind === 'relocate') {
      if (operation.rule.file.startsWith('theme/') || operation.into.file.startsWith('theme/') ||
          operation.into.file === 'styles.css') throw new Error('Relocate only an original rule to its owner');
      const rule = locate(operation.rule);
      const anchor = locate({ ...operation.after, file: operation.into.file });
      if (JSON.stringify(context(rule)) !== JSON.stringify(context(anchor))) {
        throw new Error('Relocation must preserve exact media/supports context');
      }
      const selected = rule.clone({ selector: normalize(operation.rule.selector) });
      anchor.after(selected);
      consume(rule, operation.rule.selector);
      actions.push({ kind: 'relocate', rule: operation.rule, into: operation.into, after: operation.after });
    } else if (operation.kind === 'remove') {
      const rule = locate(operation.rule);
      if (operation.properties) {
        const selected = splitMember(rule, operation.rule.selector);
        selected.walkDecls((declaration) => {
          if (operation.properties.includes(declaration.prop)) declaration.remove();
        });
        if (!selected.nodes.some((node) => node.type === 'decl')) selected.remove();
      } else consume(rule, operation.rule.selector);
      actions.push({ kind: 'remove', rule: operation.rule, properties: operation.properties });
    } else if (operation.kind === 'variables') {
      const rule = splitMember(locate(operation.rule), operation.rule.selector);
      rule.walkDecls((declaration) => {
        declaration.value = declaration.value.replace(/var\((--[\w-]+)/g, (whole, token) =>
          operation.replace[token] ? `var(${operation.replace[token]}` : whole);
      });
      actions.push({ kind: 'variables', rule: operation.rule, replace: operation.replace });
    } else if (operation.kind === 'remove-import') {
      let count = 0;
      get(operation.file).walkAtRules('import', (node) => {
        if (node.params.replace(/^['"]|['"]$/g, '') === operation.import) { node.remove(); count++; }
      });
      if (count !== 1) throw new Error(`Expected exactly one import: ${operation.import}`);
      actions.push({ kind: 'remove-import', file: operation.file, import: operation.import });
    } else throw new Error(`Unknown operation: ${operation.kind}`);
  }
  // Validate every output before any write; output contains no changed existing test.
  const changed = [...files].map(([file, entry]) => {
    const after = entry.root.toString();
    postcss.parse(after, { from: entry.path });
    return { file, path: entry.path, before: entry.before, after };
  }).filter(({ before, after }) => before !== after);
  const summary = { region: manifest.region, applied: apply, actions, files: changed.map((entry) => ({
    file: entry.file, beforeSha256: sha(entry.before), afterSha256: sha(entry.after),
    beforeLines: entry.before.split('\n').length - 1, afterLines: entry.after.split('\n').length - 1,
  })) };
  if (apply) {
    const directory = join(sourceRoot, 'outputs/E5-migrations', `${Date.now()}-${manifest.region}`);
    mkdirSync(directory, { recursive: true });
    // Full file backup enables a one-region rollback after the mandatory visual gate.
    writeFileSync(join(directory, 'backup.json'), JSON.stringify(changed, null, 2));
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    changed.forEach(({ path, after }) => writeFileSync(path, after));
    writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
    summary.backup = relative(sourceRoot, directory);
  } else summary.preview = changed.map(({ file, before, after }) => ({ file, before, after }));
  return summary;
}

const [command = 'help', manifestPath, confirmation] = process.argv.slice(2);
if (command === 'inventory') console.log(JSON.stringify(inventory(), null, 2));
else if (['preview', 'apply'].includes(command)) {
  if (!manifestPath) throw new Error('Provide an explicit one-region JSON manifest');
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
  if (command === 'apply' && confirmation !== `--region=${manifest.region}`) {
    throw new Error(`Apply requires --region=${manifest.region}; run preview first`);
  }
  console.log(JSON.stringify(migrate(manifest, command === 'apply'), null, 2));
} else if (command === 'help') console.log(`E5 CSS helper (read-only by default)
  node scripts/e5-css-migrate.mjs inventory > outputs/E5-inventory.json
  node scripts/e5-css-migrate.mjs preview outputs/E5-region.json
  node scripts/e5-css-migrate.mjs apply outputs/E5-region.json --region=NAME

Each manifest names one region. References use CSS paths relative to packages/web/src,
one selector member, exact outer-to-inner at contexts, and occurrence only if ambiguous.
Merge modifies the original owner rule, consumes only the selected theme member, and
does not append a theme block. Explicit remove/variables operations handle old dark
rules and local token replacement. After applying: build + visual comparison against
the unchanged baseline. Any difference requires restoring backup.json and retrying.
This helper does not run a migration, build, visual update, token cleanup, or rollback
implicitly. Do not batch regions or use --update-snapshots during E5.`);
else throw new Error(`Unknown command: ${command}`);
