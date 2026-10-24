import { PERSONAL_ACCESS_TOKEN_PATTERN } from '../../core/src/tokens';
import { setTimeout as pause } from 'node:timers/promises';
import { normalizeServer, type Credential } from './credentials';

export type DeviceRequest = { code: string; verifyUrl: string; expiresIn: number; interval: number };
type Reply = { status?: string; interval?: number; token?: string; tokenId?: string; expiresAt?: string; user?: { id?: string } };
const combined = (signal?: AbortSignal, timeout = 30000) => signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
async function request(server: string, route: string, body: unknown, signal?: AbortSignal, token?: string) {
  const response = await fetch(`${server}/api/v1/cli-auth/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hcd-request': '1', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), redirect: 'error', signal: combined(signal) });
  if (response.status === 204 || response.status === 401) return { response, data: {} as Reply & Record<string, unknown> };
  if (Number(response.headers.get('content-length')) > 16384) { await response.body?.cancel(); throw new Error('Authorization response exceeds size limit.'); }
  const reader = response.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  if (!reader) throw new Error('Invalid authorization response.');
  try {
    while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 16384) { await reader.cancel(); throw new Error('Authorization response exceeds size limit.'); } chunks.push(item.value); }
  } finally { reader.releaseLock(); }
  let data: Reply & Record<string, unknown>;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); }
  catch { throw new Error('Invalid authorization response.'); }
  return { response, data };
}

/** Device authorization transport. Opening a browser is delegated to the caller. */
export async function loginWithDevice(options: {
  server: string; hostname: string; signal?: AbortSignal;
  onRequest: (request: DeviceRequest) => void | Promise<void>;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): Promise<Credential> {
  const server = normalizeServer(options.server);
  const started = await request(server, 'start', { clientName: 'mdoc', hostname: options.hostname }, options.signal);
  if (!started.response.ok) throw new Error(`Could not start CLI authorization (${started.response.status}).`);
  const { code, verifyUrl, pollToken, expiresIn } = started.data;
  if (typeof code !== 'string' || !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code) || typeof verifyUrl !== 'string' || typeof pollToken !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(pollToken) || typeof expiresIn !== 'number' || !Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 600) throw new Error('Invalid device authorization request.');
  const destination = new URL(verifyUrl);
  if (destination.origin !== server || destination.pathname !== '/cli-auth' || destination.username || destination.password || destination.hash || [...destination.searchParams.keys()].length !== 1 || destination.searchParams.get('code') !== code) throw new Error('Authorization URL does not match this HCD server.');
  let interval = Math.max(3, Math.min(60, Number(started.data.interval) || 3));
  const signal = combined(options.signal, expiresIn * 1000);
  const wait = options.wait ?? ((milliseconds, currentSignal) => pause(milliseconds, undefined, { signal: currentSignal }));
  await options.onRequest({ code, verifyUrl: destination.href, expiresIn, interval });
  let failures = 0;
  try {
    while (!signal.aborted) {
      await wait(interval * 1000, signal); signal.throwIfAborted();
      let polled: Awaited<ReturnType<typeof request>>;
      try { polled = await request(server, 'poll', { pollToken }, signal); }
      catch { if (signal.aborted) signal.throwIfAborted(); if (++failures > 3) throw new Error('Authorization polling failed. Start login again.'); interval = Math.min(30, interval + 3); continue; }
      if (polled.response.status === 429) { interval = Math.max(interval, Math.min(60, Number(polled.response.headers.get('retry-after')) || Number(polled.data.interval) || interval + 3)); continue; }
      if (polled.response.status >= 500 && ++failures <= 3) { interval = Math.min(30, interval + 3); continue; }
      if (!polled.response.ok) throw new Error(`Authorization polling failed (${polled.response.status}).`);
      failures = 0;
      if (polled.data.status === 'pending') continue;
      if (polled.data.status === 'denied') throw new Error('CLI authorization was denied.');
      if (polled.data.status === 'expired') throw new Error('CLI authorization expired. Start login again.');
      const { token, tokenId, expiresAt, user } = polled.data;
      if (polled.data.status !== 'approved' || typeof token !== 'string' || !PERSONAL_ACCESS_TOKEN_PATTERN.test(token) || typeof tokenId !== 'string' || !/^tok_[A-Za-z0-9_-]{8,100}$/.test(tokenId) || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt)) || !/^u_[A-Za-z0-9_-]{8,80}$/.test(user?.id ?? '')) throw new Error('Invalid approved authorization response.');
      return { server, token, tokenId, expiresAt, savedAt: new Date().toISOString() };
    }
    throw new Error('CLI authorization expired. Start login again.');
  } catch (error) {
    if (options.signal?.aborted) throw new Error('CLI login was cancelled.');
    if (signal.aborted) throw new Error('CLI authorization expired. Start login again.');
    throw error;
  }
}
export async function revokeCredential(credential: Pick<Credential, 'server' | 'token'>): Promise<void> {
  const server = normalizeServer(credential.server);
  const { response } = await request(server, 'revoke', {}, undefined, credential.token);
  if (!response.ok && response.status !== 401) throw new Error(`Token revocation failed (${response.status}); local credentials were retained.`);
}
