// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import ShareLinks from './ShareLinks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it.each([
  { locale: 'zh-CN', code: 'RATE_LIMITED', expected: '尝试次数过多，请稍后再试。' },
  { locale: 'en', code: 'RATE_LIMITED', expected: 'Too many attempts. Try again later.' },
  { locale: 'zh-CN', code: 'UNKNOWN_FROM_NEW_SERVER', expected: '操作失败，请重试。' },
] as const)('AT-15 C3 localizes share-link API errors for $locale and $code', async ({ locale, code, expected }) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code, message: 'Raw server message' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<ShareLinks docId="d_aaaaaaab" locale={locale} currentVersion={1} onClose={() => undefined} />);
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(expected);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});
