// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LogoutAllSessions from './LogoutAllSessions';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const json = (value: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status });

async function fixture(response: Response) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetch = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetch);
  const onLoggedOut = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<LogoutAllSessions locale="en" onLoggedOut={onLoggedOut} />));
  return { fetch, onLoggedOut };
}

async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('logout all sessions', () => {
  it('B6 requires an in-page confirmation before ending all sessions', async () => {
    const f = await fixture(json({}, 204));
    await click('Sign out all devices');
    expect(document.body.textContent).toContain('Sign out everywhere?');
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.onLoggedOut).not.toHaveBeenCalled();
    await click('Cancel');
    expect(document.body.textContent).not.toContain('Sign out everywhere?');
  });

  it('B6 calls the guarded logout-all endpoint and reports success through onLoggedOut', async () => {
    const f = await fixture(json({}, 204));
    await click('Sign out all devices');
    await click('Confirm sign out');
    expect(f.fetch).toHaveBeenCalledWith(
      '/api/v1/auth/logout-all',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-HCD-Request': '1' },
        body: '{}',
      }),
    );
    expect(f.onLoggedOut).toHaveBeenCalledTimes(1);
  });

  it('B6 gives a safe message when the endpoint rejects the session', async () => {
    const f = await fixture(json({ error: { code: 'UNAUTHENTICATED', message: 'session secret' } }, 401));
    await click('Sign out all devices');
    await click('Confirm sign out');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Your session has expired. Please sign in again.',
    );
    expect(document.body.textContent).not.toContain('session secret');
    expect(f.onLoggedOut).not.toHaveBeenCalled();
  });
});
