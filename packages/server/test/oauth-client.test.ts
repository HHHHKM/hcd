import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ resolve4: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ resolve4: mocks.resolve4 }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { loadClientMetadata } from '../src/oauth-client';

describe('client metadata HTTPS transport (mock network)', () => {
  let status: number; let contentType: string; let cache: string; let body: string; let interrupted: boolean;
  let destroyed: boolean;
  beforeEach(() => {
    mocks.resolve4.mockReset().mockResolvedValue(['8.8.8.8']); mocks.request.mockReset();
    status = 200; contentType = 'application/json'; cache = 'max-age=86400'; body = '{"client_name":"Example"}'; interrupted = false; destroyed = false;
    mocks.request.mockImplementation((_url, options, callback) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      options.signal.addEventListener('abort', () => req.emit('error', new Error('aborted')), { once: true });
      req.end = () => queueMicrotask(() => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; destroy: () => void };
        response.statusCode = status; response.headers = { 'content-type': contentType, 'cache-control': cache };
        response.destroy = () => { destroyed = true; };
        callback(response);
        if (destroyed) return;
        if (interrupted) response.emit('error', new Error('socket closed'));
        else { response.emit('data', Buffer.from(body)); if (!destroyed) response.emit('end'); }
      });
      return req;
    });
  });
  it('AT-37 pins the resolved public IP while preserving the TLS hostname and bounded cache ' +
     'lifetime', async () => {
    const result = await loadClientMetadata('https://client.example/oauth.json');
    expect(result).toEqual({ body: { client_name: 'Example' }, maxAge: 3600 });
    const [url, options] = mocks.request.mock.calls[0]!;
    expect(url.hostname).toBe('client.example'); expect(options.agent).toBe(false); expect(options.family).toBe(4);
    expect(options.headers).toEqual({ accept: 'application/json' });
    const callback = vi.fn(); options.lookup('client.example', {}, callback); expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    cache = 'no-store'; expect((await loadClientMetadata('https://client.example/oauth.json')).maxAge).toBe(0);
  });
  it('AT-37 rejects private/mixed DNS answers and invalid URLs before connecting', async () => {
    for (const url of ['http://client.example/id', 'https://localhost/id', 'https://a.localhost/id', 'https://127.0.0.1/id', 'https://[::1]/id', 'https://client.example/', 'https://client.example:444/id', 'https://client.example/id#', 'https://user:pass@client.example/id']) await expect(loadClientMetadata(url)).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.resolve4.mockResolvedValue(['8.8.8.8', '10.0.0.1']); await expect(loadClientMetadata('https://client.example/id')).rejects.toThrow(); expect(mocks.request).not.toHaveBeenCalled();
  });
  it('AT-37 rejects redirects, non-JSON, oversized bodies, invalid JSON and interrupted responses', async () => {
    status = 302; await expect(loadClientMetadata('https://client.example/id')).rejects.toThrow(); expect(destroyed).toBe(true);
    destroyed = false; status = 200; contentType = 'text/html'; await expect(loadClientMetadata('https://client.example/id')).rejects.toThrow();
    destroyed = false; contentType = 'application/json'; body = 'x'.repeat(65537); await expect(loadClientMetadata('https://client.example/id')).rejects.toThrow(); expect(destroyed).toBe(true);
    destroyed = false; body = '{'; await expect(loadClientMetadata('https://client.example/id')).rejects.toThrow();
    interrupted = true; await expect(loadClientMetadata('https://client.example/id')).rejects.toThrow();
  });
  it('AT-37 bounds DNS resolution time', async () => {
    vi.useFakeTimers();
    try { mocks.resolve4.mockImplementation(() => new Promise(() => {})); const pending = expect(loadClientMetadata('https://client.example/id')).rejects.toThrow(); await vi.advanceTimersByTimeAsync(3001); await pending; expect(mocks.request).not.toHaveBeenCalled(); }
    finally { vi.useRealTimers(); }
  });
});
