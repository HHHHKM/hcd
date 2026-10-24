import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/rate-limit';
import { createApp } from '../src/app';

describe('request limits', () => {
  it('isolates callers, supplies retry seconds and reopens the window', () => {
    const consume = createRateLimiter();
    expect(consume('one', 2, 1000)).toBe(0); expect(consume('one', 2, 2000)).toBe(0); expect(consume('one', 2, 3000)).toBe(58);
    expect(consume('two', 2, 3000)).toBe(0); expect(consume('one', 2, 61000)).toBe(0);
  });
  it('limits file operations across sessions and limits public share lookup requests', async () => {
    const app = createApp({ databasePath: ':memory:', seed: true, appUrl: 'http://localhost:5173' }); await app.ready();
    try {
      const common = { origin: 'http://localhost:5173', 'x-hcd-request': '1' };
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: common, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      for (let i = 0; i < 10; i++) expect((await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/export?format=json', headers: { cookie } })).statusCode).toBe(200);
      const token = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: { ...common, cookie }, payload: { scopes: ['read'] } }); expect(token.statusCode).toBe(201);
      const limited = await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/export?format=json', headers: { authorization: `Bearer ${token.json().token}` } });
      expect(limited.statusCode).toBe(429); expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect((await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab', headers: { cookie } })).statusCode).toBe(200);
      for (let i = 0; i < 60; i++) expect((await app.inject({ method: 'GET', url: '/api/v1/s/invalid/doc' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/api/v1/s/invalid/doc' })).statusCode).toBe(429);
    } finally { await app.close(); }
  });
});
