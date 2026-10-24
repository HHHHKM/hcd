import { expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = dirname(fileURLToPath(import.meta.url));
const namespaces = [
  'common',
  'auth',
  'docs',
  'reader',
  'editor',
  'review',
  'history',
  'comments',
  'import',
  'settings',
  'admin',
  'ai',
  'share',
  'export',
  'notifications',
  'errors',
];
const keys = (value: unknown, prefix = ''): string[] =>
  value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key))
    : [prefix];
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? entry.name === 'locales'
        ? []
        : sources(join(directory, entry.name))
      : /\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
}
it('AT-15 C3 bundles matching English and Chinese dictionaries with every specified namespace', () => {
  expect(existsSync(join(root, 'locales/en.json'))).toBe(true);
  expect(existsSync(join(root, 'locales/zh-CN.json'))).toBe(true);
  const en = JSON.parse(readFileSync(join(root, 'locales/en.json'), 'utf8'));
  const zh = JSON.parse(readFileSync(join(root, 'locales/zh-CN.json'), 'utf8'));
  expect(Object.keys(en).sort()).toEqual([...namespaces].sort());
  expect(keys(en).sort()).toEqual(keys(zh).sort());
  expect(keys(en).length).toBeGreaterThan(100);
});
it('AT-15 C3 uses existing dot-separated translation keys and removes inline bilingual choices', () => {
  const dictionary = existsSync(join(root, 'locales/en.json'))
    ? JSON.parse(readFileSync(join(root, 'locales/en.json'), 'utf8'))
    : {};
  const available = new Set(keys(dictionary));
  const invalid: string[] = [];
  for (const path of sources(root)) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        (node.expression.getText(source) === 't' || node.expression.getText(source) === 'translate')
      ) {
        const key = node.arguments[node.expression.getText(source) === 'translate' ? 1 : 0];
        if (key && ts.isStringLiteral(key) && !available.has(key.text)) invalid.push(`${path}: missing ${key.text}`);
        if (node.arguments.length >= 2 && key && ts.isStringLiteral(key) && /[\u3400-\u9fff]/.test(key.text))
          invalid.push(`${path}: bilingual t()`);
      }
      if (ts.isConditionalExpression(node) && /(?:\bzh\b|locale|language)/.test(node.condition.getText(source))) {
        const a = node.whenTrue.getText(source);
        const b = node.whenFalse.getText(source);
        if (/[\u3400-\u9fff]/.test(a + b) && /['"`]/.test(a + b))
          invalid.push(`${path}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}: inline bilingual choice`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(invalid).toEqual([]);
});

it('AT-15 C3 prefers the account locale and keeps independent renderers in their requested ' + 'language', async () => {
  const { preferredLocale, translate, formatNumber, formatDate, formatRelativeTime, i18n } =
    await import('./shared/i18n');
  expect(preferredLocale('en', 'zh-TW')).toBe('en');
  expect(preferredLocale('zh-CN', 'en-GB')).toBe('zh-CN');
  expect(preferredLocale(null, 'zh-TW')).toBe('zh-CN');
  expect(preferredLocale(undefined, 'de-DE')).toBe('en');
  await i18n.changeLanguage('zh-CN');
  expect(translate('en', 'settings.changePassword')).toBe('Change password');
  expect(translate('zh-CN', 'settings.changePassword')).toBe('修改密码');
  expect(formatNumber(12345, 'en')).toBe(new Intl.NumberFormat('en').format(12345));
  expect(formatDate('2026-10-24T01:02:03Z', 'en', { year: 'numeric', timeZone: 'UTC' })).toBe('2026');
  expect(formatRelativeTime(-1, 'day', 'en')).toBe('yesterday');
});
it('AT-15 C3 keeps the bilingual fallback for a notification kind introduced by a newer server', async () => {
  const { notificationLabel } = await import('./NotificationBell');
  expect(notificationLabel('future_event', 'en')).toBe('A document was updated');
  expect(notificationLabel('future_event', 'zh-CN')).toBe('文档有更新');
  expect(notificationLabel('reply', 'en')).toBe('A discussion has a new reply');
});
