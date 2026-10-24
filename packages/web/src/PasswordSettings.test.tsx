// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PasswordSettings from './PasswordSettings';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const user = { id: 'u_fixture', name: 'Member', email: 'member@example.com', locale: 'en' };
async function fixture(responses: Response[]) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetch = vi.fn(async () => responses.shift()!);
  vi.stubGlobal('fetch', fetch);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const updated = vi.fn();
  await act(async () => root!.render(<PasswordSettings locale="en" onUpdated={updated} />));
  return { fetch, updated };
}
async function enterPasswords(currentPassword: string, newPassword: string) {
  const inputs = document.querySelectorAll('input');
  await act(async () => {
    for (const [index, value] of [currentPassword, newPassword].entries()) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(inputs[index], value);
      inputs[index]!.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}
async function submit() {
  await act(async () => {
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('password settings', () => {
  it('B7 renders labelled current and new password controls with the policy constraints', () => {
    const html = renderToStaticMarkup(<PasswordSettings locale="en" />);
    expect(html).toContain('Change password');
    expect(html).toContain('Current password');
    expect(html).toContain('New password');
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toMatch(/autocomplete="new-password"/i);
    expect(html).toMatch(/minlength="10"/i);
    expect(html).toMatch(/maxlength="1024"/i);
    expect(html).toContain('type="submit"');
  });

  it('B7 posts current and new passwords with the session write guard and clears fields after success', async () => {
    const f = await fixture([json({ user })]);
    await enterPasswords('old password', 'new password');
    await submit();
    expect(f.fetch).toHaveBeenCalledWith(
      '/api/v1/me',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-HCD-Request': '1' },
        body: JSON.stringify({ currentPassword: 'old password', newPassword: 'new password' }),
      }),
    );
    expect(f.updated).toHaveBeenCalledWith(user);
    expect(Array.from(document.querySelectorAll('input')).map((input) => input.value)).toEqual(['', '']);
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Password updated.');
  });

  it('B7 reports invalid current passwords and rate limits without exposing server content', async () => {
    const f = await fixture([
      json({ error: { code: 'INVALID_CREDENTIALS', message: 'private response' } }, 401),
      json({ error: { code: 'RATE_LIMITED', message: 'private response' } }, 429),
    ]);
    await enterPasswords('wrong password', 'new password');
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('The current password is incorrect.');
    expect(document.body.textContent).not.toContain('private response');
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Too many attempts. Try again later.');
    expect(f.updated).not.toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it('B7 rejects a short new password before making a request', async () => {
    const f = await fixture([]);
    await enterPasswords('old password', 'too short');
    await submit();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('The new password must be 10–1024 characters.');
  });
});
