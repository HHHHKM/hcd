import { resolve4 } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
export type ClientMetadata = { client_name: string; redirect_uris: string[]; grant_types: string[]; response_types: ['code']; token_endpoint_auth_method: 'none'; client_id?: string };
export class OAuthError extends Error { constructor(public code: string, public status = 400) { super(code); } }
export const oauthScopes = ['read', 'comment', 'submit', 'ai_tasks', 'preview'] as const;
export function parseScopes(value: unknown): string[] {
  if (typeof value !== 'string' || value.length > 200) throw new OAuthError('invalid_scope');
  const scopes = [...new Set(value.split(' ').filter(Boolean))];
  if (!scopes.length || scopes.some((scope) => !oauthScopes.includes(scope as typeof oauthScopes[number]))) throw new OAuthError('invalid_scope');
  return scopes;
}
export function validRedirect(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)) return false;
  try { const uri = new URL(value); return !value.includes('#') && !uri.hash && !uri.username && !uri.password && !uri.hostname.includes('*') && (uri.protocol === 'https:' || (uri.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(uri.hostname))); } catch { return false; }
}
export function validateClient(body: unknown, clientId?: string): ClientMetadata {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OAuthError('invalid_client_metadata');
  const data = body as Record<string, unknown>;
  if (typeof data.client_name !== 'string' || !data.client_name.trim() || data.client_name.length > 100 || /[\x00-\x1f\x7f]/.test(data.client_name)) throw new OAuthError('invalid_client_metadata');
  if (!Array.isArray(data.redirect_uris) || !data.redirect_uris.length || data.redirect_uris.length > 10 || !data.redirect_uris.every(validRedirect)) throw new OAuthError('invalid_redirect_uri');
  if (clientId && data.client_id !== clientId) throw new OAuthError('invalid_client_metadata');
  if (data.token_endpoint_auth_method !== undefined && data.token_endpoint_auth_method !== 'none') throw new OAuthError('invalid_client_metadata');
  const grants = data.grant_types ?? ['authorization_code', 'refresh_token'];
  if (!Array.isArray(grants) || !grants.includes('authorization_code') || grants.some((value) => !['authorization_code', 'refresh_token'].includes(String(value)))) throw new OAuthError('invalid_client_metadata');
  if (data.response_types !== undefined && (!Array.isArray(data.response_types) || data.response_types.length !== 1 || data.response_types[0] !== 'code')) throw new OAuthError('invalid_client_metadata');
  return { client_name: data.client_name.trim(), redirect_uris: [...new Set(data.redirect_uris as string[])], grant_types: [...new Set(grants as string[])], response_types: ['code'], token_endpoint_auth_method: 'none', ...(clientId ? { client_id: clientId } : {}) };
}
export function publicIPv4(address: string) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return a > 0 && a < 224 && ![10, 127].includes(a) && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113);
}
export type MetadataLoader = (url: string) => Promise<{ body: unknown; maxAge: number }>;
/** Resolve and pin a public IPv4 address; TLS still verifies the original hostname. No redirects/cookies. */
export const loadClientMetadata: MetadataLoader = async (value) => {
  let url: URL; try { url = new URL(value); } catch { throw new OAuthError('invalid_client'); }
  if (/[\s\x00-\x1f\x7f]/.test(value) || value.includes('#') || url.protocol !== 'https:' || url.pathname === '/' || url.username || url.password || url.hash || url.search || (url.port && url.port !== '443') || isIP(url.hostname.replace(/^\[|\]$/g, '')) || url.hostname.replace(/\.$/, '') === 'localhost' || url.hostname.replace(/\.$/, '').endsWith('.localhost')) throw new OAuthError('invalid_client');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([resolve4(url.hostname), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new OAuthError('invalid_client')), 3000); })]).finally(() => { if (timeout) clearTimeout(timeout); });
  if (!addresses.length || !addresses.every(publicIPv4)) throw new OAuthError('invalid_client');
  return new Promise((resolve, reject) => {
    const fail = () => reject(new OAuthError('invalid_client'));
    const req = request(url, { method: 'GET', family: 4, agent: false, signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' }, lookup: (_host, _options, callback) => callback(null, addresses[0]!, 4) }, (response) => {
      if (response.statusCode !== 200 || !/^application\/json(?:;|$)/i.test(String(response.headers['content-type'] ?? ''))) { response.destroy(); fail(); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 65536) { response.destroy(); fail(); } else chunks.push(chunk); });
      response.on('error', fail);
      response.on('end', () => { try { const cache = String(response.headers['cache-control'] ?? ''); const maxAge = /no-store|no-cache/i.test(cache) ? 0 : Math.min(3600, Number(/(?:^|,)\s*max-age=(\d+)/i.exec(cache)?.[1] ?? 300)); resolve({ body: JSON.parse(Buffer.concat(chunks).toString('utf8')), maxAge }); } catch { fail(); } });
    }); req.on('error', fail); req.end();
  });
};
