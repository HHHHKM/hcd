import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/src/app';
import { openDatabase } from '../../server/src/db';
import * as credentials from './credentials';
import * as device from './device-login';
import { main } from './index';

const docId = 'd_aaaaaaab'; const otherDocId = 'd_aaaaaaac';
const originalRead = credentials.readCredentials; const originalSave = credentials.saveCredential; const originalRemove = credentials.removeCredential;
const originalLogin = device.loginWithDevice;
type Flow = { code: string; verifyUrl: string; pollToken: string; expiresIn: number; interval: number };
type Approved = { status: 'approved'; token: string; tokenId: string; expiresAt: string };
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hcd-device-auth-integration-'));
  const credentialPath = join(root, 'private-cli', 'credentials.json');
  // Pin the configured verification origin to the real listening address.
  const reservation = createServer();
  await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('Port reservation failed.');
  const origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
  const db = openDatabase(':memory:'); let clock = Date.now();
  const controls = { revokeFailure: false, echoCredentialError: false };
  const app = createApp({ db, dataDir: join(root, 'server'), appUrl: origin, secretKey: 'cli-device-integration-secret', seed: true, cliAuth: { now: () => clock }, exports: { autoStart: false } });
  app.addHook('onRequest', async (request, reply) => {
    if (controls.revokeFailure && request.url === '/api/v1/cli-auth/revoke') return reply.code(503).send({ error: { code: 'TEMPORARILY_UNAVAILABLE' } });
    if (controls.echoCredentialError && request.url === '/api/v1/me') return reply.code(401).send({ error: { code: `${request.headers.authorization?.slice(7)}\u001b[31m` } });
  });
  cleanup.push(async () => { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  await app.listen({ port: address.port, host: '127.0.0.1' });
  db.prepare('UPDATE documents SET ai_enabled=1').run();
  const fetch = globalThis.fetch;
  const json = async (path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-hcd-request': '1', origin }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const signIn = await json('/auth/login', { email: 'd@example.com', password: 'hcd-demo-2026' });
  expect(signIn.status).toBe(200); await signIn.arrayBuffer();
  const cookie = signIn.headers.get('set-cookie')?.split(';')[0]; if (!cookie) throw new Error('Missing session cookie.');
  const output: string[] = []; const errors: string[] = []; const waits: number[] = [];
  // Every CLI credential call is redirected to this fixture; no real home path is read.
  vi.stubEnv('HCD_TOKEN', undefined);
  vi.spyOn(credentials, 'readCredentials').mockImplementation(path => originalRead(path ?? credentialPath));
  const save = vi.spyOn(credentials, 'saveCredential').mockImplementation((value, path) => originalSave(value, path ?? credentialPath));
  vi.spyOn(credentials, 'removeCredential').mockImplementation((value, path) => originalRemove(value, path ?? credentialPath));
  vi.spyOn(device, 'loginWithDevice').mockImplementation(options => originalLogin({ ...options, wait: async (milliseconds, signal) => { signal.throwIfAborted(); waits.push(milliseconds); clock += milliseconds; } }));
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output.push(String(chunk)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { errors.push(String(chunk)); return true; });
  const read = () => originalRead(credentialPath);
  const issueManualToken = async (name: string) => {
    const response = await json('/me/tokens', { name, scopes: ['read'], docIds: [docId] }, { cookie });
    expect(response.status).toBe(201); return (await response.json() as { token: string }).token;
  };
  const decide = async (flow: Flow, decision: 'approve' | 'deny') => {
    expect(flow.verifyUrl).toBe(`${origin}/cli-auth?code=${flow.code}`);
    const review = await json(`/cli-auth/requests/${flow.code}`, undefined, { cookie });
    expect(review.status).toBe(200);
    const shown = await review.json() as { request: { code: string; hostname: string; status: string }; documents: Array<{ id: string }> };
    expect(shown.request).toMatchObject({ code: flow.code, status: 'pending' }); expect(shown.request.hostname.length).toBeGreaterThan(0);
    expect(shown.documents.some(doc => doc.id === docId)).toBe(true); expect(JSON.stringify(shown)).not.toContain(flow.pollToken);
    const approved = await json(`/cli-auth/requests/${flow.code}`, { decision, scopes: ['read', 'comment', 'submit', 'ai_tasks'], docIds: [docId], expiresInDays: 30 }, { cookie });
    expect(approved.status).toBe(200); expect(await approved.json()).toEqual({ status: decision === 'approve' ? 'approved' : 'denied' });
  };
  return { root, db, origin, controls, fetch, json, cookie, credentialPath, output, errors, waits, save, read, issueManualToken, decide, advance: (milliseconds: number) => { clock += milliseconds; } };
}

function authorize(f: Awaited<ReturnType<typeof fixture>>, options: { outcome?: 'approve' | 'deny' | 'expire'; loseFirstPoll?: boolean } = {}) {
  const flows: Flow[] = []; const polls: Approved[] = []; const pollSecrets: string[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await f.fetch(input, init);
    if (String(input) === `${f.origin}/api/v1/cli-auth/start`) {
      expect(response.status).toBe(200); const flow = await response.clone().json() as Flow; flows.push(flow);
      if (options.outcome === 'expire') f.advance(600001);
      else await f.decide(flow, options.outcome === 'deny' ? 'deny' : 'approve');
    }
    if (String(input) === `${f.origin}/api/v1/cli-auth/poll`) {
      pollSecrets.push((JSON.parse(String(init?.body)) as { pollToken: string }).pollToken);
      const payload = await response.clone().json() as Approved;
      if (response.ok && payload.status === 'approved') {
        polls.push(payload);
        if (options.loseFirstPoll && polls.length === 1) { await response.arrayBuffer(); throw new Error('Lost approved poll response after server commit.'); }
      }
    }
    return response;
  });
  return { spy, flows, polls, pollSecrets };
}

describe('CLI device authorization over the real HTTP API', () => {
  it('recovers a lost approved poll, saves one scoped credential privately and revokes it through logout', async () => {
    const f = await fixture(); const flow = authorize(f, { loseFirstPoll: true });
    await main(['login', f.origin, '--no-open']);
    expect(flow.flows).toHaveLength(1); expect(flow.polls).toHaveLength(2);
    expect(flow.polls[1]).toEqual(flow.polls[0]); expect(flow.pollSecrets).toEqual([flow.flows[0]!.pollToken, flow.flows[0]!.pollToken]);
    expect(f.waits).toEqual([3000, 6000]); expect(f.db.prepare('SELECT COUNT(*) count FROM api_tokens').get()).toEqual({ count: 1 });
    const saved = (await f.read()).servers[0]!;
    expect(saved).toMatchObject({ server: f.origin, token: flow.polls[0]!.token, tokenId: flow.polls[0]!.tokenId, expiresAt: flow.polls[0]!.expiresAt });
    if (process.platform !== 'win32') expect((await stat(f.credentialPath)).mode & 0o777).toBe(0o600);
    const header = { authorization: `Bearer ${saved.token}` };
    expect((await f.json('/me', undefined, header)).status).toBe(200);
    expect((await f.json(`/docs/${docId}`, undefined, header)).status).toBe(200);
    expect((await f.json(`/docs/${otherDocId}`, undefined, { cookie: f.cookie })).status).toBe(200);
    expect((await f.json(`/docs/${otherDocId}`, undefined, header)).status).toBe(404);
    const printed = f.output.join('') + f.errors.join('');
    expect(printed).toContain(flow.flows[0]!.code); expect(printed).not.toContain(saved.token); expect(printed).not.toContain(flow.flows[0]!.pollToken);
    await main(['logout', f.origin]);
    expect((await f.read()).servers).toEqual([]); expect((await f.json('/me', undefined, header)).status).toBe(401);
    expect(f.db.prepare('SELECT COUNT(*) count FROM api_tokens WHERE revoked_at IS NOT NULL').get()).toEqual({ count: 1 });
  });

  it('keeps the existing credential byte-for-byte when the device request is denied', async () => {
    const f = await fixture(); const old = await f.issueManualToken('Existing login');
    await main(['login', f.origin, '--token', old]); const before = await readFile(f.credentialPath);
    const flow = authorize(f, { outcome: 'deny' });
    await expect(main(['login', f.origin, '--no-open'])).rejects.toThrow('denied');
    expect(flow.flows).toHaveLength(1); expect(flow.polls).toEqual([]); expect(await readFile(f.credentialPath)).toEqual(before);
    expect(f.db.prepare('SELECT COUNT(*) count FROM api_tokens').get()).toEqual({ count: 1 });
    expect((await f.json('/me', undefined, { authorization: `Bearer ${old}` })).status).toBe(200);
  });

  it('exits an expired device request without issuing or writing a credential', async () => {
    const f = await fixture(); const flow = authorize(f, { outcome: 'expire' });
    await expect(main(['login', f.origin, '--no-open'])).rejects.toThrow('expired');
    expect(flow.flows).toHaveLength(1); expect(f.save).not.toHaveBeenCalled();
    expect((await f.read()).servers).toEqual([]); await expect(readFile(f.credentialPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.db.prepare('SELECT COUNT(*) count FROM api_tokens').get()).toEqual({ count: 0 });
    expect(f.db.prepare('SELECT status,poll_hash,session_hash FROM cli_auth_requests').get()).toEqual({ status: 'expired', poll_hash: null, session_hash: null });
  });

  it('retains failed revocations and protects a replacement login while an older logout is waiting', async () => {
    const f = await fixture(); const flow = authorize(f); await main(['login', f.origin, '--no-open']); flow.spy.mockRestore();
    const old = (await f.read()).servers[0]!; const before = await readFile(f.credentialPath);
    f.controls.revokeFailure = true;
    await expect(main(['logout', f.origin])).rejects.toThrow('could not be revoked');
    expect(await readFile(f.credentialPath)).toEqual(before);
    expect((await f.json('/me', undefined, { authorization: `Bearer ${old.token}` })).status).toBe(200);
    f.controls.revokeFailure = false;
    let reached!: () => void; let release!: () => void;
    const revocationReached = new Promise<void>(done => { reached = done; }); const continueLogout = new Promise<void>(done => { release = done; });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const response = await f.fetch(input, init);
      if (String(input) === `${f.origin}/api/v1/cli-auth/revoke`) { expect(response.status).toBe(204); reached(); await continueLogout; }
      return response;
    });
    const logout = main(['logout', f.origin]);
    try {
      await revocationReached; const replacement = await f.issueManualToken('Replacement login');
      await main(['login', f.origin, '--token', replacement]); release(); await logout;
      expect((await f.read()).servers).toEqual([expect.objectContaining({ server: f.origin, token: replacement })]);
      expect((await f.json('/me', undefined, { authorization: `Bearer ${old.token}` })).status).toBe(401);
      expect((await f.json('/me', undefined, { authorization: `Bearer ${replacement}` })).status).toBe(200);
    } finally { release(); await logout.catch(() => {}); }
  });

  it('A2 rejects a malformed explicit PAT before contacting the account endpoint', async () => {
    const f = await fixture();
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(main(['login', f.origin, '--token', `hcd_pat_${'a'.repeat(43)}`])).rejects.toThrow('Provide a valid personal access token');
    expect(fetch).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });

  it('does not expose credentials or terminal controls from a malicious account-validation error', async () => {
    const f = await fixture(); f.controls.echoCredentialError = true;
    const token = `hcd_pat_${'fixture'.repeat(4)}abcd`; 
    let failure: unknown;
    try { await main(['login', f.origin, '--token', token]); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error); expect((failure as Error).message).toBe('HCD request failed (401).');
    const exposed = `${(failure as Error).message}${f.output.join('')}${f.errors.join('')}`;
    expect(exposed).not.toContain(token); expect(exposed).not.toContain('\u001b'); expect(f.save).not.toHaveBeenCalled();
    await expect(readFile(f.credentialPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
