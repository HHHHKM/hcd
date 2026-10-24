// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import DiscussionThreads from './DiscussionThreads';
import type { Thread } from './api';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const thread: Thread = {
  root: {
    id: 'cm_guest',
    body: 'Guest question',
    authorId: 'g_fixture',
    external: true,
    createdAt: '2026-10-24T00:00:00Z',
  },
  replies: [],
};
async function render(threads: Thread[]) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <DiscussionThreads
        docId="d_fixture"
        userId="u_member"
        role="commenter"
        locale="en"
        aiEnabled={false}
        threads={threads}
        onRefresh={async () => {}}
      />,
    ),
  );
}
it('B2 warns members above the reply box that a guest-started thread is visible externally', async () => {
  await render([thread]);
  const reply = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Reply');
  expect(reply).toBeTruthy();
  await act(async () => reply!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const form = document.querySelector('.discussion-form')!;
  expect(form.textContent).toContain('Replies in this thread are visible to the external guest');
  const textarea = form.querySelector('textarea')!;
  const note = form.querySelector('[role="note"]')!;
  expect(note).toBeTruthy();
  expect(note.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('B9 shows resolution actions to members with a nondeleted reply in the thread', async () => {
  await render([
    {
      ...thread,
      replies: [{ id: 'cm_reply', body: 'Member reply', authorId: 'u_member', createdAt: '2026-10-24T00:00:01Z' }],
    },
  ]);
  expect([...document.querySelectorAll('button')].some((button) => button.textContent === 'Resolve')).toBe(true);
});
