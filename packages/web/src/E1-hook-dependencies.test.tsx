// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import AuthLink from './AuthLink';
import SpaceIntegrations from './SpaceIntegrations';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('E1 uses the current integration locale for late errors without repeating its read request', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let resolve!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<SpaceIntegrations spaceId="s_fixture" locale="en" />));
  await act(async () => root!.render(<SpaceIntegrations spaceId="s_fixture" locale="zh-CN" />));
  await act(async () => {
    resolve(
      new Response(JSON.stringify({ error: { code: 'INTEGRATION_TARGET_INVALID', message: 'private failure' } }), {
        status: 400,
      }),
    );
  });
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Webhook 必须属于服务器配置的飞书或 Lark 域名。');
  await act(async () => root!.render(<SpaceIntegrations spaceId="s_fixture" locale="en" />));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    'The webhook must use the configured Feishu or Lark host.',
  );
  expect(host.textContent).not.toContain('private failure');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('E1 retranslates a settled integration failure without starting a request or render loop', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetch = vi.fn(async () => new Response('{}', { status: 500 }));
  vi.stubGlobal('fetch', fetch);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<SpaceIntegrations spaceId="s_fixture" locale="en" />));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    'The request failed. Check configuration, permissions and network access.',
  );
  await act(async () => root!.render(<SpaceIntegrations spaceId="s_fixture" locale="zh-CN" />));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('操作未完成，请检查配置、权限与网络后重试。');
  await act(async () => root!.render(<SpaceIntegrations spaceId="s_fixture" locale="zh-CN" />));
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('E1 updates the email-link page title on language switches without rechecking the token', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en');
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ kind: 'invite', email: 'member@example.com', name: 'Member' })),
  );
  vi.stubGlobal('fetch', fetch);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<AuthLink token="fixture_invitation_token" kind="invite" />));
  expect(document.title).toBe('Welcome to HCD · HCD');
  expect(document.documentElement.lang).toBe('en');
  await act(async () => (host.querySelector('.language-button') as HTMLButtonElement).click());
  expect(document.title).toBe('欢迎加入 HCD · HCD');
  expect(document.documentElement.lang).toBe('zh-CN');
  expect(host.querySelector('h1')?.textContent).toBe('欢迎加入 HCD');
  await act(async () => (host.querySelector('.language-button') as HTMLButtonElement).click());
  expect(document.title).toBe('Welcome to HCD · HCD');
  expect(document.documentElement.lang).toBe('en');
  expect(fetch).toHaveBeenCalledTimes(1);
});
