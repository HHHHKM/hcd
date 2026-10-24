// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ShareLinks from './ShareLinks';
import { Administration, MembersPanel } from './Administration';

let root: Root | undefined;
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function render(view: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(view));
  return host;
}
function button(host: ParentNode, label: string) {
  const result = Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.trim() === label);
  expect(result, `button ${label}`).toBeDefined();
  return result!;
}
async function click(host: ParentNode, label: string) {
  await act(async () => button(host, label).click());
}
function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

it('E4 marks revocation as dangerous while preserving cancellation and one confirmed DELETE', async () => {
  let active = true;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === '/api/v1/docs/d_fixture/share-links' && init?.method === 'GET')
      return json({
        links: [
          {
            id: 'link_fixture',
            role: 'viewer',
            versionPin: null,
            showComments: true,
            commenterAvailable: false,
            expiresAt: null,
            revokedAt: active ? null : '2026-10-24T00:00:00Z',
            createdAt: '2026-10-24T00:00:00Z',
            active,
          },
        ],
        commenterAvailable: false,
      });
    if (input === '/api/v1/docs/d_fixture/share-links/link_fixture' && init?.method === 'DELETE') {
      active = false;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request ${init?.method} ${input}`);
  });
  vi.stubGlobal('fetch', fetch);
  const host = await render(<ShareLinks docId="d_fixture" locale="en" currentVersion={1} onClose={() => {}} />);
  expect.soft(button(host, 'Revoke').classList.contains('danger-action')).toBe(true);
  await click(host, 'Revoke');
  expect.soft(button(host, 'Confirm revocation').classList.contains('danger-action')).toBe(true);
  expect(button(host, 'Cancel').classList.contains('danger-action')).toBe(false);
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  await click(host, 'Cancel');
  expect(host.querySelector('.share-revoke-confirm')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  await click(host, 'Revoke');
  await click(host, 'Confirm revocation');
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/docs/d_fixture/share-links/link_fixture',
    expect.objectContaining({ method: 'DELETE' }),
  );
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(2);
  expect(host.querySelector('.share-revoke-confirm')).toBeNull();
});

it.each([
  { disabledAt: null, label: 'Disable', danger: true, disabled: true },
  { disabledAt: '2026-10-24T00:00:00Z', label: 'Enable', danger: false, disabled: false },
])(
  'E4 gives account $label the appropriate visual tone without changing its confirmed PATCH',
  async ({ disabledAt, label, danger, disabled }) => {
    const onUpdated = vi.fn();
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/api/v1/admin/users' && init?.method === 'GET')
        return json({
          users: [{ id: 'u_member', name: 'Member', email: 'member@example.com', locale: 'en', disabledAt }],
        });
      if (input === '/api/v1/admin/users/u_member' && init?.method === 'PATCH')
        return new Response(null, { status: 204 });
      throw new Error(`Unexpected request ${init?.method} ${input}`);
    });
    vi.stubGlobal('fetch', fetch);
    const host = await render(
      <Administration
        user={{ id: 'u_admin', name: 'Admin', email: 'admin@example.com', locale: 'en', isAdmin: true }}
        spaces={[]}
        locale="en"
        onClose={() => {}}
        onUpdated={onUpdated}
      />,
    );
    expect.soft(button(host, label).classList.contains('danger-action')).toBe(danger);
    await click(host, label);
    expect.soft(button(host, 'Confirm').classList.contains('danger-action')).toBe(danger);
    expect(button(host, 'Cancel').classList.contains('danger-action')).toBe(false);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0);
    await click(host, 'Cancel');
    expect(host.querySelector('.admin-confirm')).toBeNull();
    expect(onUpdated).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    await click(host, label);
    await click(host, 'Confirm');
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/admin/users/u_member',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ disabled }) }),
    );
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(2);
    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.admin-confirm')).toBeNull();
  },
);

it('E4 marks role removal as dangerous while preserving cancellation and one confirmed DELETE', async () => {
  let removed = false;
  const onUpdated = vi.fn();
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === '/api/v1/docs/d_fixture/members' && init?.method === 'GET')
      return json({
        members: removed
          ? []
          : [{ id: 'u_member', name: 'Member', email: 'member@example.com', role: 'editor', documentRole: 'editor' }],
      });
    if (input === '/api/v1/docs/d_fixture/members/u_member' && init?.method === 'DELETE') {
      removed = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request ${init?.method} ${input}`);
  });
  vi.stubGlobal('fetch', fetch);
  const host = await render(<MembersPanel kind="docs" id="d_fixture" locale="en" editable onUpdated={onUpdated} />);
  expect.soft(button(host, 'Remove role').classList.contains('danger-action')).toBe(true);
  await click(host, 'Remove role');
  expect.soft(button(host, 'Confirm').classList.contains('danger-action')).toBe(true);
  expect(button(host, 'Cancel').classList.contains('danger-action')).toBe(false);
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  await click(host, 'Cancel');
  expect(host.querySelector('.admin-confirm')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onUpdated).not.toHaveBeenCalled();
  await click(host, 'Remove role');
  await click(host, 'Confirm');
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/docs/d_fixture/members/u_member',
    expect.objectContaining({ method: 'DELETE' }),
  );
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(2);
  expect(onUpdated).toHaveBeenCalledTimes(1);
  expect(host.querySelector('.admin-list')?.textContent).not.toContain('Member');
});
