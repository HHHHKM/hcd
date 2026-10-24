// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import DiscussionThreads from './DiscussionThreads';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const button = (name: string) => [...document.querySelectorAll('button')].find((item) => item.textContent === name);
it(
  'C6 keeps reply and resolve visible and requires inline confirmation ' + 'before deleting from the comment menu',
  async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const refresh = vi.fn(async () => {});
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
          threads={[
            {
              root: {
                id: 'cm_own',
                body: 'My comment',
                authorId: 'u_member',
                createdAt: '2026-10-24T00:00:00Z',
              },
              replies: [],
            },
          ]}
          onRefresh={refresh}
        />,
      ),
    );
    expect(button('Reply')).toBeTruthy();
    expect(button('Resolve')).toBeTruthy();
    expect(button('Edit')).toBeUndefined();
    expect(button('Delete')).toBeUndefined();
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Comment actions"]');
    expect(trigger).toBeTruthy();
    await act(async () => trigger!.click());
    const remove = document.querySelector<HTMLButtonElement>('[role="menuitem"].danger-action');
    expect(remove?.textContent).toBe('Delete');
    await act(async () => remove!.click());
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Delete this comment?');
    await act(async () => button('Cancel')!.click());
    expect(fetch).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger!.click());
    await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"].danger-action')!.click());
    await act(async () => document.querySelector<HTMLButtonElement>('[role="alertdialog"] .danger-action')!.click());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/comments/cm_own');
    expect(refresh).toHaveBeenCalledTimes(1);
  },
);
