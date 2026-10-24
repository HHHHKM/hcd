import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { loginWithDevice, revokeCredential } from './device-login';
const code = 'ABCD-EFGH'; const pollToken = 'p'.repeat(43);
const approved = { status: 'approved', token: `hcd_pat_${'t'.repeat(32)}`, tokenId: 'tok_abcdefgh', expiresAt: '2027-01-01T00:00:00Z', user: { id: 'u_abcdefgh' } };
async function fixture(handler: (request: IncomingMessage, response: ServerResponse, body: Record<string, unknown>, origin: string) => unknown | Promise<unknown>) {
  let origin = '';
  const server = createServer(async (request, response) => { let body = ''; for await (const chunk of request) body += chunk; response.setHeader('content-type', 'application/json'); await handler(request, response, body ? JSON.parse(body) : {}, origin); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture'); origin = `http://127.0.0.1:${address.port}`;
  return { origin, close: async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); } };
}
const start = (origin: string) => ({ code, pollToken, verifyUrl: `${origin}/cli-auth?code=${code}`, expiresIn: 600, interval: 3 });
describe('CLI device authorization transport', () => {
  it('A2 rejects a device response whose PAT is not exactly 32 lowercase base32 characters', async () => {
    const f = await fixture((request, response, _body, origin) => response.end(JSON.stringify(request.url?.endsWith('/start') ? start(origin) : { ...approved, token: `hcd_pat_${'t'.repeat(43)}` })));
    try { await expect(loginWithDevice({ server: f.origin, hostname: 'test', onRequest: () => {}, wait: async () => {} })).rejects.toThrow('Invalid approved authorization response.'); }
    finally { await f.close(); }
  });
  it('pins the server, displays only the public code, honors poll backoff and returns the approved credential', async () => {
    const waits: number[] = []; let polls = 0; let displayed: unknown;
    const f = await fixture((request, response, body, origin) => {
      expect(request.headers.authorization).toBeUndefined(); expect(request.headers['x-hcd-request']).toBe('1');
      if (request.url?.endsWith('/start')) { expect(body).toEqual({ clientName: 'mdoc', hostname: 'my-laptop' }); response.end(JSON.stringify(start(origin))); return; }
      expect(body).toEqual({ pollToken }); polls++;
      if (polls === 1) response.writeHead(429, { 'retry-after': '6' }).end(JSON.stringify({ error: { code: 'SLOW_DOWN' }, interval: 6 }));
      else response.end(JSON.stringify(polls === 2 ? { status: 'pending' } : approved));
    });
    try {
      const credential = await loginWithDevice({ server: f.origin, hostname: 'my-laptop', onRequest: value => { displayed = value; }, wait: async milliseconds => { waits.push(milliseconds); } });
      expect(credential).toMatchObject({ server: f.origin, token: approved.token, tokenId: approved.tokenId, expiresAt: approved.expiresAt });
      expect(displayed).toEqual({ code, verifyUrl: `${f.origin}/cli-auth?code=${code}`, expiresIn: 600, interval: 3 }); expect(JSON.stringify(displayed)).not.toContain(pollToken); expect(waits).toEqual([3000, 6000, 6000]);
    } finally { await f.close(); }
  });
  it.each(['denied', 'expired'] as const)('does not produce credentials after %s consent', async status => {
    const f = await fixture((request, response, _body, origin) => response.end(JSON.stringify(request.url?.endsWith('/start') ? start(origin) : { status })));
    try { await expect(loginWithDevice({ server: f.origin, hostname: 'test', onRequest: () => {}, wait: async () => {} })).rejects.toThrow(status); }
    finally { await f.close(); }
  });
  it('rejects foreign confirmation destinations before invoking the browser callback or polling', async () => {
    let called = false; const f = await fixture((_request, response, _body, origin) => response.end(JSON.stringify({ ...start(origin), verifyUrl: `https://other.test/cli-auth?code=${code}` })));
    try { await expect(loginWithDevice({ server: f.origin, hostname: 'test', onRequest: () => { called = true; } })).rejects.toThrow('does not match'); expect(called).toBe(false); }
    finally { await f.close(); }
  });
  it('retries a dropped poll response with exactly the same secret and no duplicate start', async () => {
    let polls = 0; let starts = 0; const f = await fixture((request, response, body, origin) => {
      if (request.url?.endsWith('/start')) { starts++; response.end(JSON.stringify(start(origin))); return; }
      expect(body).toEqual({ pollToken }); if (++polls === 1) request.socket.destroy(); else response.end(JSON.stringify(approved));
    });
    try { expect((await loginWithDevice({ server: f.origin, hostname: 'test', onRequest: () => {}, wait: async () => {} })).token).toBe(approved.token); expect(starts).toBe(1); expect(polls).toBe(2); }
    finally { await f.close(); }
  });
  it('cancels before another poll and never returns a partial credential', async () => {
    const controller = new AbortController(); let polls = 0;
    const f = await fixture((request, response, _body, origin) => { if (request.url?.endsWith('/poll')) polls++; response.end(JSON.stringify(start(origin))); });
    try { await expect(loginWithDevice({ server: f.origin, hostname: 'test', signal: controller.signal, onRequest: () => {}, wait: async () => { controller.abort(); } })).rejects.toThrow('cancelled'); expect(polls).toBe(0); }
    finally { await f.close(); }
  });
  it('rejects redirects and malformed approvals without returning secrets', async () => {
    let mode = 'redirect'; const f = await fixture((request, response, _body, origin) => {
      if (mode === 'redirect') { response.writeHead(302, { location: 'https://other.test' }).end('{}'); return; }
      response.end(JSON.stringify(request.url?.endsWith('/start') ? start(origin) : { ...approved, user: { id: 'wrong' } }));
    });
    try {
      await expect(loginWithDevice({ server: f.origin, hostname: 'test', onRequest: () => {} })).rejects.toThrow(); mode = 'malformed';
      await expect(loginWithDevice({ server: f.origin, hostname: 'test', onRequest: () => {}, wait: async () => {} })).rejects.toThrow('Invalid approved');
    } finally { await f.close(); }
  });
  it('revokes only the current bearer credential and keeps failures explicit', async () => {
    let status = 204; const f = await fixture((request, response, body) => { expect(request.url).toBe('/api/v1/cli-auth/revoke'); expect(request.headers.authorization).toBe(`Bearer ${approved.token}`); expect(body).toEqual({}); response.writeHead(status).end(status === 204 ? undefined : '{}'); });
    try {
      await revokeCredential({ server: f.origin, token: approved.token }); status = 503;
      await expect(revokeCredential({ server: f.origin, token: approved.token })).rejects.toThrow('retained'); status = 401; await revokeCredential({ server: f.origin, token: approved.token });
    } finally { await f.close(); }
  });
});
