// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MembersPanel } from './Administration';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
it('AT-15 C3 translates administrator error codes without exposing or truncating their keys', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'LAST_OWNER' } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <MembersPanel kind="docs" id="d_aaaaaaab" locale="en" editable={false} onUpdated={() => undefined} />,
      );
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('At least one owner must remain.');
    await act(async () => {
      root.render(
        <MembersPanel kind="docs" id="d_aaaaaaab" locale="zh-CN" editable={false} onUpdated={() => undefined} />,
      );
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('至少需要保留一位负责人。');
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});
