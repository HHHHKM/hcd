import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, vi } from 'vitest';
import SharedDocument from '../SharedDocument';
import type { Document } from '../../../core/src/model';
import type { Thread } from '../api';

export let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
export function snapshot(token: string) {
  const content: Document = {
    schemaVersion: 1,
    id: `d_${token}`,
    title: `${token} document`,
    theme: { id: 'default', version: 1, overrides: {} },
    modules: [
      {
        id: `m_${token}`,
        title: 'Main',
        blocks: [{ id: `n_${token}`, type: 'paragraph', text: [{ t: `${token} visible content` }] }],
      },
    ],
  };
  return {
    content,
    doc: {
      id: content.id,
      title: content.title,
      currentVersion: 1,
      version: 1,
      role: 'commenter',
      showComments: true,
      aiEnabled: false,
      expiresAt: null,
    },
    guest: { id: 'g_fixture', name: 'Guest' },
  };
}
export async function enterComment(value: string) {
  const input = document.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
export async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent === text);
  expect(button).toBeDefined();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
export async function fixture(
  options: {
    pinned?: boolean;
    role?: string;
    guest?: boolean;
    showComments?: boolean;
    threads?: Thread[];
    initialComments?: Promise<Response>;
  } = {},
) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  Element.prototype.scrollIntoView = vi.fn();
  const controls = {
    failComments: false,
    failAfterPost: false,
    rejectPost: '',
    pendingPost: null as Promise<Response> | null,
    secondDocument: null as Promise<Response> | null,
    postedThread: null as Thread | null,
  };
  const posted: unknown[] = [];
  let commentsReads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const match = String(input).match(/^\/api\/v1\/s\/(one|two)\/(doc|comments)$/);
      if (!match) throw new Error(`Unexpected fixture request: ${input}`);
      const token = match[1]!;
      if (match[2] === 'doc') {
        if (token === 'two' && controls.secondDocument) return controls.secondDocument;
        const shared = snapshot(token);
        return json({
          ...shared,
          guest: options.guest === false ? null : shared.guest,
          doc: {
            ...shared.doc,
            currentVersion: options.pinned ? 2 : 1,
            role: options.role ?? 'commenter',
            showComments: options.showComments ?? true,
          },
        });
      }
      if (init?.method === 'POST') {
        const submitted = JSON.parse(String(init.body));
        posted.push(submitted);
        if (controls.rejectPost) return json({ error: { code: controls.rejectPost } }, 409);
        controls.failComments = controls.failAfterPost;
        if (submitted.anchor?.quote)
          controls.postedThread = {
            root: {
              id: 'cm_posted',
              body: submitted.body,
              authorId: 'g_fixture',
              createdAt: '2026-10-23T00:00:00Z',
              anchor: submitted.anchor,
            },
            replies: [],
            anchorState: 'ok',
            range: { start: 4, end: 11 },
          };
        return controls.pendingPost ?? json({ comment: { id: 'cm_posted' } }, 201);
      }
      if (++commentsReads === 1 && options.initialComments) return options.initialComments;
      if (controls.failComments) return json({ error: { code: 'UNAVAILABLE' } }, 503);
      return json({
        threads: controls.postedThread
          ? [controls.postedThread]
          : (options.threads ?? [
              {
                root: {
                  id: `cm_${token}`,
                  body: `${token} discussion`,
                  authorId: 'g_fixture',
                  authorName: 'Guest',
                  createdAt: '2026-10-23T00:00:00Z',
                },
                replies: [],
              },
            ]),
      });
    }),
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<SharedDocument token="one" />));
  return { controls, posted };
}
