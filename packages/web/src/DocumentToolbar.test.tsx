// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import DocumentToolbar from './DocumentToolbar';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function render(width: number) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('480') && width <= 480,
    addEventListener() {},
    removeEventListener() {},
  }));
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const history = vi.fn();
  await act(async () =>
    root!.render(
      <DocumentToolbar
        locale="en"
        docMeta={{ id: 'd_fixture', title: 'Doc', role: 'owner' }}
        displayedVersion={2}
        pendingCount={3}
        canEdit
        editing={false}
        busy={false}
        composing={false}
        mobileReading={width <= 720}
        screen="document"
        goHome={() => {}}
        openReview={() => {}}
        submitChanges={() => {}}
        startEditing={() => {}}
        exportHtml={() => {}}
        exportZip={() => {}}
        loadHistory={history}
        setCommentsOpen={() => {}}
        setShareOpen={() => {}}
        setAiTasksOpen={() => {}}
        setMembersOpen={() => {}}
        setArchiveDocId={() => {}}
      />,
    ),
  );
  return { history };
}
const button = (name: string) => [...document.querySelectorAll('button')].find((item) => item.textContent === name);
it('C5 groups secondary document actions in a keyboard menu and restores focus on Escape', async () => {
  await render(1440);
  expect(button('Edit document')).toBeTruthy();
  expect(button('Review & publish (3)')).toBeTruthy();
  expect(button('Share')).toBeTruthy();
  expect(button('Export ZIP')).toBeUndefined();
  const more = document.querySelector<HTMLButtonElement>('[aria-label="More document actions"]')!;
  expect(more).toBeTruthy();
  more.focus();
  await act(async () => more.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  expect(items.map((item) => item.textContent)).toContain('Export ZIP');
  expect(document.activeElement).toBe(items[0]);
  await act(async () => items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
  expect(document.activeElement).toBe(items.at(-1));
  await act(async () => items.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(more);
});
it('C5 offers only reading actions at 360px while preserving access to read-only review', async () => {
  const { history } = await render(360);
  expect(button('Edit document')).toBeUndefined();
  expect(button('Review & publish (3)')).toBeUndefined();
  expect(button('View review')).toBeTruthy();
  const more = document.querySelector<HTMLButtonElement>('[aria-label="More document actions"]')!;
  await act(async () => more.click());
  expect([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toContain(
    'Version history',
  );
  await act(async () => button('Version history')!.click());
  expect(history).toHaveBeenCalledOnce();
});
