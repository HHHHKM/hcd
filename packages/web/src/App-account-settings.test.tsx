// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const json = (value: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status });
const user = { id: 'u_fixture', name: 'Member', email: 'member@example.com', locale: 'en' };

async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent === label || item.getAttribute('aria-label') === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function fixture() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const path = String(input).replace('/api/v1', '');
    if (path === '/auth/config') return json({ passwordResetEnabled: false });
    if (path === '/me') return json({ user });
    if (path === '/spaces') return json({ spaces: [] });
    if (path === '/docs') return json({ docs: [] });
    if (path === '/notifications/unread-count') return json({ count: 0 });
    if (path === '/me/tokens')
      return json({
        tokens: [
          {
            id: 'tok_fixture',
            name: 'Local CLI',
            scopes: ['read'],
            created_at: '2026-10-20T00:00:00Z',
            last_used_at: '2026-10-24T07:00:00Z',
            last_used_ip: '198.51.100.44',
          },
        ],
      });
    if (path === '/auth/logout-all' && init?.method === 'POST') return json({}, 204);
    throw new Error(`Unexpected fixture request: ${path}`);
  });
  vi.stubGlobal('fetch', fetch);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  await click('Settings');
  return fetch;
}

describe('personal account settings integration (synthetic DOM)', () => {
  it('B6 confirms logout-all within settings and returns to sign in after success', async () => {
    const fetch = await fixture();
    await click('Sign out all devices');
    expect(fetch).not.toHaveBeenCalledWith('/api/v1/auth/logout-all', expect.anything());
    await click('Confirm sign out');
    expect(document.querySelector('.settings-modal')).toBeNull();
    expect(document.querySelector('.auth-card')?.textContent).toContain('Sign in to HCD');
  });

  it('B7 exposes the password form within personal settings', async () => {
    await fixture();
    expect(document.querySelector('.settings-modal .password-form')).not.toBeNull();
    expect(document.querySelector('.settings-modal')?.textContent).toContain('Current password');
  });

  it('B8 displays token last-use timestamp and IP in personal settings', async () => {
    await fixture();
    expect(document.querySelector('.token-list')?.textContent).toContain('Last used:');
    expect(document.querySelector('.token-list')?.textContent).toContain('198.51.100.44');
    expect(document.querySelector('.token-list time')?.getAttribute('datetime')).toBe('2026-10-24T07:00:00Z');
  });
});
