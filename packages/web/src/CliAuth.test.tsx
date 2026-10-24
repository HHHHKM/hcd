import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError } from './api';
import CliAuth, {
  buildCliAuthDecision,
  CliAuthConsent,
  CliAuthRequestView,
  normalizeCliAuthCode,
  readCliAuthRequest,
  sendCliAuthDecision,
  type CliAuthData,
} from './CliAuth';

const noop = () => {};
const data: CliAuthData = {
  request: {
    code: 'ABCD-EFGH',
    clientName: '<script>mdoc</script>',
    hostname: '<img src=x onerror=steal()>',
    scopes: ['read', 'comment', 'submit', 'ai_tasks'],
    optionalScopes: ['preview'],
    expiresAt: '2099-01-01T00:00:00.000Z',
    status: 'pending',
  },
  documents: [
    { id: 'd_aaaaaaaa', title: '<script>Private plan</script>' },
    { id: 'd_bbbbbbbb', title: 'Second document' },
  ],
  user: { id: 'u_aaaaaaaa', email: 'member@example.com', name: 'Member', locale: 'en' },
};
const choice = {
  decision: 'approve' as const,
  confirmed: true,
  scopes: ['read', 'submit'],
  allDocuments: false,
  selected: ['d_aaaaaaaa'],
  days: 30,
};
afterEach(() => vi.unstubAllGlobals());

describe('CLI authorization markup', () => {
  it('renders manual code entry without a browser global or implicit approval', () => {
    const html = renderToStaticMarkup(<CliAuth initialCode="" initialLocale="en" />);
    expect(html).toContain('Enter the code displayed in your terminal');
    expect(html).toContain('Review request');
    expect(html).not.toContain('Allow terminal access');
    expect(html).not.toContain('Loading terminal');
    const invalid = renderToStaticMarkup(<CliAuth initialCode="https://attacker.invalid" initialLocale="zh-CN" />);
    expect(invalid).toContain('请输入八位验证码');
    expect(invalid).not.toContain('<a href="https://attacker.invalid');
  });

  it('withholds stale data and offers sign-in without granting permissions', () => {
    const stale = renderToStaticMarkup(
      <CliAuthRequestView
        requestKey="new"
        resource={{ key: 'old', status: 'ready', value: data }}
        locale="en"
        onRetry={noop}
      />,
    );
    expect(stale).toContain('Loading terminal authorization request');
    expect(stale).not.toContain('member@example.com');
    expect(stale).not.toContain('ABCD-EFGH');
    const login = renderToStaticMarkup(
      <CliAuthRequestView requestKey="new" resource={{ key: 'new', status: 'login' }} locale="en" onRetry={noop} />,
    );
    expect(login).toContain('Signing in does not grant access');
    expect(login).toMatch(/autocomplete="current-password"/i);
    expect(login).toContain('Sign in and review');
    expect(login).not.toContain('Allow terminal access');
  });

  it(
    'AT-09 shows the code and untrusted computer escaped, with explicit confirmation and narrow ' + 'document defaults',
    () => {
      const html = renderToStaticMarkup(<CliAuthConsent data={data} locale="en" onRetry={noop} />);
      expect(html).toContain('ABCD-EFGH');
      expect(html).toContain('Compare this code with the one shown in your terminal');
      expect(html).toContain('I confirm the code matches my terminal');
      expect(html).toContain('&lt;img src=x onerror=steal()&gt;');
      expect(html).toContain('&lt;script&gt;mdoc&lt;/script&gt;');
      expect(html).toContain('&lt;script&gt;Private plan&lt;/script&gt;');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img');
      expect(html).toContain('HCD has not verified them');
      expect(html).toContain('checked=""/><span>Only selected documents');
      expect(html).toContain('All documents I can access now and in the future');
      expect(html).toContain('min="1" max="90" step="1" required="" value="30"');
      expect(html).toContain('disabled="">Allow terminal access');
      expect(html).toContain('button-soft">Deny');
      expect(html.match(/checked=""/g)).toHaveLength(5); // Four default scopes and selected-document mode.
    },
  );

  it('AT-15 provides Chinese permission copy, optional preview scope and a clear empty document ' + 'state', () => {
    const html = renderToStaticMarkup(
      <CliAuthConsent data={{ ...data, documents: [] }} locale="zh-CN" onRetry={noop} />,
    );
    expect(html).toContain('核对你正在使用的电脑');
    expect(html).toContain('提交修改供人工审核');
    expect(html).toContain('读取审核预览');
    expect(html).toContain('暂无可选择的文档');
    expect(html).toContain('全部当前及未来有权访问的文档');
    expect(html).toContain('disabled="">允许终端访问');
  });

  it('renders approved, denied and expired outcomes without approval controls or credentials', () => {
    for (const [status, text] of [
      ['approved', 'Terminal access approved'],
      ['denied', 'Authorization denied'],
      ['expired', 'Code expired'],
    ] as const) {
      const html = renderToStaticMarkup(
        <CliAuthConsent data={{ ...data, request: { ...data.request, status } }} locale="en" onRetry={noop} />,
      );
      expect(html).toContain(text);
      expect(html).not.toContain('<input');
      expect(html).not.toContain('hcd_pat_');
      expect(html).not.toContain('Allow terminal access');
      expect(html).not.toContain('member@example.com');
    }
    const elapsed = renderToStaticMarkup(
      <CliAuthConsent
        data={{ ...data, request: { ...data.request, expiresAt: '2020-01-01T00:00:00Z' } }}
        locale="en"
        onRetry={noop}
      />,
    );
    expect(elapsed).toContain('Code expired');
    expect(elapsed).not.toContain('Allow terminal access');
  });

  it('AT-09 uses fixed session/access/network error messages without exposing raw server content', () => {
    for (const reason of [
      new ApiError('CLI_AUTH_SESSION_MISMATCH', 'hcd_pat_secret', 409),
      new ApiError('SESSION_REQUIRED', 'hcd_pat_secret', 403),
      new Error('hcd_pat_secret'),
    ]) {
      const html = renderToStaticMarkup(
        <CliAuthRequestView
          requestKey="error"
          resource={{ key: 'error', status: 'error', reason }}
          locale="en"
          onRetry={noop}
        />,
      );
      expect(html).toContain('Reload request');
      expect(html).toContain('role="alert"');
      expect(html).not.toContain('hcd_pat_secret');
      expect(html).not.toContain('Allow terminal access');
    }
  });
});

describe('CLI authorization choices and requests', () => {
  it('normalizes only an eight-character code and rejects paths and ambiguous extra punctuation', () => {
    expect(normalizeCliAuthCode(' abcdEFGH ')).toBe('ABCD-EFGH');
    expect(normalizeCliAuthCode('abcd-efgh')).toBe('ABCD-EFGH');
    for (const code of ['', '../abcd-efgh', 'ABCD--EFGH', 'ABCD EFGH', 'ABCD-EFGH?x=y', '１２３４５６７８'])
      expect(normalizeCliAuthCode(code)).toBeNull();
  });

  it(
    'requires explicit confirmation, offered permissions, a valid lifetime ' + 'and a valid nonempty selected range',
    () => {
      expect(buildCliAuthDecision(data, choice)).toEqual({
        decision: 'approve',
        scopes: ['read', 'submit'],
        docIds: ['d_aaaaaaaa'],
        expiresInDays: 30,
      });
      expect(
        buildCliAuthDecision(data, { ...choice, scopes: ['preview'], allDocuments: true, selected: [], days: 90 }),
      ).toEqual({ decision: 'approve', scopes: ['preview'], docIds: null, expiresInDays: 90 });
      for (const invalid of [
        { confirmed: false },
        { scopes: [] },
        { scopes: ['publish'] },
        { scopes: ['read', 'read'] },
        { days: 0 },
        { days: 91 },
        { days: 1.5 },
        { days: NaN },
        { selected: [] },
        { selected: ['d_unknown'] },
        { selected: ['d_aaaaaaaa', 'd_aaaaaaaa'] },
      ])
        expect(() => buildCliAuthDecision(data, { ...choice, ...invalid })).toThrow('CLI_AUTH_INVALID_CHOICE');
      expect(
        buildCliAuthDecision(data, {
          ...choice,
          decision: 'deny',
          confirmed: false,
          scopes: [],
          selected: [],
          days: NaN,
        }).decision,
      ).toBe('deny');
    },
  );

  it('reads the normalized code with same-origin cookies and the caller cancellation signal', async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));
    vi.stubGlobal('fetch', fetch);
    expect(await readCliAuthRequest('abcdefgh', controller.signal)).toEqual(data);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/cli-auth/requests/ABCD-EFGH',
      expect.objectContaining({ credentials: 'same-origin', method: 'GET', signal: controller.signal }),
    );
  });

  it('rejects mismatched request identity and unknown permissions before displaying an authorization', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...data, request: { ...data.request, code: 'WXYZ-EFGH' } })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...data, request: { ...data.request, scopes: ['publish'] } })),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(readCliAuthRequest('ABCD-EFGH', new AbortController().signal)).rejects.toThrow(
      'CLI_AUTH_RESPONSE_MISMATCH',
    );
    await expect(readCliAuthRequest('ABCD-EFGH', new AbortController().signal)).rejects.toThrow(
      'CLI_AUTH_RESPONSE_MISMATCH',
    );
    await expect(readCliAuthRequest('../escape', new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_CODE',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('suppresses late reads even when the transport ignores cancellation', async () => {
    const controller = new AbortController();
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const request = readCliAuthRequest('ABCD-EFGH', controller.signal);
    controller.abort();
    resolve(new Response(JSON.stringify(data)));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it(
    'AT-11 posts exactly the chosen range, scopes and lifetime with CSRF marker and no bearer ' + 'token',
    async () => {
      const controller = new AbortController();
      const body = buildCliAuthDecision(data, choice);
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ status: 'approved', token: 'hcd_pat_never_render' })));
      vi.stubGlobal('fetch', fetch);
      expect(await sendCliAuthDecision('ABCD-EFGH', body, controller.signal)).toEqual({ status: 'approved' });
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/cli-auth/requests/ABCD-EFGH',
        expect.objectContaining({
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-HCD-Request': '1' },
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
      );
    },
  );

  it('does not present a mismatched or late decision as successful', async () => {
    const body = buildCliAuthDecision(data, choice);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'denied' }))));
    await expect(sendCliAuthDecision('ABCD-EFGH', body, new AbortController().signal)).rejects.toThrow(
      'CLI_AUTH_DECISION_MISMATCH',
    );
    const controller = new AbortController();
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const request = sendCliAuthDecision('ABCD-EFGH', body, controller.signal);
    controller.abort();
    resolve(new Response(JSON.stringify({ status: 'approved' })));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('shows an expiry returned during decision as expiry, without retrying approval', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'expired' })));
    vi.stubGlobal('fetch', fetch);
    expect(
      await sendCliAuthDecision('ABCD-EFGH', buildCliAuthDecision(data, choice), new AbortController().signal),
    ).toEqual({ status: 'expired' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
