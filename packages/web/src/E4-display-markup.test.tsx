// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import MentionPicker from './features/comments/MentionPicker';
import { CliAuthConsent, type CliAuthData } from './CliAuth';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('E4 shows local mention initials without changing the member name or selected mention', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            members: [
              { id: 'u_member', name: '王明' },
              { id: 'u_other', name: '<Member>' },
            ],
          }),
        ),
    ),
  );
  const select = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<MentionPicker docId="d_fixture" locale="en" aiEnabled onSelect={select} />));
  await act(async () => (host.querySelector('.text-link') as HTMLButtonElement).click());
  const member = Array.from(host.querySelectorAll('.mention-options button')).find((item) =>
    item.textContent?.includes('王明'),
  )!;
  expect(member.querySelector('.mention-avatar[aria-hidden="true"]')?.textContent).toBe('王');
  expect(member.querySelector('.mention-name')?.textContent).toBe('王明');
  expect(host.querySelector('img')).toBeNull();
  await act(async () => (member as HTMLButtonElement).click());
  expect(select).toHaveBeenCalledWith('@[王明](u_member) ');
});

it('E4 shows the terminal code once, as plain text', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const data: CliAuthData = {
    request: {
      code: 'ABCD-EFGH',
      clientName: 'HCD',
      hostname: 'Local',
      scopes: ['read'],
      expiresAt: '2099-01-01T00:00:00Z',
      status: 'pending',
    },
    documents: [],
    user: { id: 'u_member', email: 'member@example.com', name: 'Member', locale: 'en' },
  };
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<CliAuthConsent data={data} locale="en" onRetry={() => {}} />));
  // The code exists once, as one plain text node: no hidden duplicate and no per-character wrappers.
  const code = host.querySelector('.cli-auth-code');
  expect(code?.textContent).toBe('ABCD-EFGH');
  expect(code?.children).toHaveLength(0);
  expect(host.querySelectorAll('.cli-auth-check input[type="checkbox"]:checked')).toHaveLength(1);
});
