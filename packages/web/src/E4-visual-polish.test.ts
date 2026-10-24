import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = (path: string) => readFileSync(path, 'utf8');
const source = 'packages/web/src';

it('E4 polishes the selection toolbar as a floating pill', () => {
  const styles = css(`${source}/selection-comment.css`);
  expect(styles).toMatch(/\.selection-comment-tools[\s\S]*?border-radius:\s*var\(--radius-pill\)/);
  expect(styles).toMatch(/\.selection-comment-tools[\s\S]*?box-shadow:\s*var\(--shadow-float\)/);
  expect(styles).toMatch(/\.selection-comment-tools button\s*\{[\s\S]*?white-space:\s*nowrap/);
});

it('E4 styles rich editor controls as a segmented token-based toolbar', () => {
  const editor = css(`${source}/block-editor.css`);
  const documentEditor = css(`${source}/styles/workspace-09.css`);
  expect(editor).toMatch(/\.be-rich-toolbar[\s\S]*?background:\s*var\(--fill\)/);
  expect(editor).toMatch(/\.be-rich-toolbar button\[aria-pressed='true'\][\s\S]*?color:\s*var\(--accent\)/);
  expect(documentEditor).toMatch(/\.rich-toolbar[\s\S]*?background:\s*var\(--fill\)/);
  expect(documentEditor).toMatch(/\.rich-toolbar button\[aria-pressed='true'\][\s\S]*?background:\s*var\(--accent-soft\)/);
  expect(documentEditor).toMatch(/\.rich-toolbar button\[aria-pressed='true'\][\s\S]*?color:\s*var\(--accent\)/);
});

it('E4 presents notifications with unread dots and switch rows', () => {
  const styles = css(`${source}/notifications.css`);
  expect(styles).toMatch(/\.notification-list li\.unread::before\s*\{[\s\S]*?width:\s*var\(--space-6\)[\s\S]*?height:\s*var\(--space-6\)[\s\S]*?border-radius:\s*var\(--radius-pill\)[\s\S]*?background:\s*var\(--accent\)/);
  expect(styles).not.toMatch(/\.notification-list li\.unread\s*\{[^}]*padding-left/);
  expect(styles).not.toMatch(/\.notification-list li\.unread\s*\{[^}]*border-left/);
  expect(styles).toMatch(/\.notification-preference-row\s*\{[\s\S]*?background:\s*var\(--fill\)[\s\S]*?border-radius:\s*var\(--radius-s\)/);
});

it('E4 gives sharing dialogs and expired states Apple surfaces', () => {
  const styles = css(`${source}/sharing.css`);
  expect(styles).toMatch(/\.share-links-modal\s*\{[\s\S]*?border-radius:\s*var\(--radius-xl\)[\s\S]*?box-shadow:\s*var\(--shadow-sheet\)/);
  expect(styles).toMatch(/\.share-create-form\s*\{[\s\S]*?background:\s*var\(--fill\)/);
  expect(styles).toMatch(/\.shared-state\s*\{[\s\S]*?background:\s*var\(--paper\)[\s\S]*?border-radius:\s*var\(--radius-l\)[\s\S]*?box-shadow:\s*var\(--shadow-card\)/);
});

it('E4 gives discussion, admin, import, AI and global states semantic surfaces', () => {
  expect(css(`${source}/discussion.css`)).toMatch(/\.mention-options\s*\{[\s\S]*?width:\s*clamp\(200px,\s*100%,\s*280px\)/);
  expect(css(`${source}/administration.css`)).toMatch(/\.admin-tabs\s*\{[\s\S]*?background:\s*var\(--fill\)/);
  expect(css(`${source}/styles/workspace-10.css`)).toMatch(/\.import-modal \.file-picker\s*\{[\s\S]*?border-style:\s*dashed/);
  expect(css(`${source}/styles/workspace-10.css`)).toMatch(/\.ai-task-card\s*\{[\s\S]*?background:\s*var\(--surface-raised\)/);
  expect(css(`${source}/styles/workspace-08.css`)).toMatch(/\.empty-state h2\s*\{[\s\S]*?color:\s*var\(--ink\)/);
});
