import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';

afterEach(() => vi.unstubAllEnvs());

async function exhaust(proxy: string, configured?: string) {
  vi.stubEnv('TRUST_PROXY', configured);
  const app = createApp({ databasePath: ':memory:' });
  const request = (client: string, remoteAddress = proxy) => app.inject({
    method: 'GET', url: '/api/v1/s/missing/doc', remoteAddress,
    headers: { 'x-forwarded-for': client },
  });
  for (let i = 0; i < 60; i++) expect((await request('198.51.100.1')).statusCode).toBe(404);
  expect((await request('198.51.100.1')).statusCode).toBe(429);
  return { app, request };
}

it('A1 separates clients behind a configured proxy subnet', async () => {
  const { app, request } = await exhaust('172.28.0.2', '172.28.0.0/24, 127.0.0.1');
  try { expect((await request('198.51.100.2')).statusCode).toBe(404); }
  finally { await app.close(); }
});

it('A1 ignores forged forwarded addresses from untrusted callers', async () => {
  const { app, request } = await exhaust('203.0.113.2', '172.28.0.0/24');
  try { expect((await request('198.51.100.2')).statusCode).toBe(429); }
  finally { await app.close(); }
});

it('A1 trusts no proxy when TRUST_PROXY is unset', async () => {
  const { app, request } = await exhaust('172.28.0.2');
  try { expect((await request('198.51.100.2')).statusCode).toBe(429); }
  finally { await app.close(); }
});

it('A1 explicit createApp proxy options override the environment', async () => {
  vi.stubEnv('TRUST_PROXY', '192.0.2.0/24');
  const app = createApp({ databasePath: ':memory:', trustProxy: ['172.28.0.0/24'] });
  try {
    for (let i = 0; i < 60; i++) await app.inject({ method: 'GET', url: '/api/v1/s/missing/doc', remoteAddress: '172.28.0.2', headers: { 'x-forwarded-for': '198.51.100.1' } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/s/missing/doc', remoteAddress: '172.28.0.2', headers: { 'x-forwarded-for': '198.51.100.2' } })).statusCode).toBe(404);
  } finally { await app.close(); }
});

it('A1 explicit false ignores forwarded headers even with configured proxies', async () => {
  vi.stubEnv('TRUST_PROXY', '172.28.0.0/24');
  const app = createApp({ databasePath: ':memory:', trustProxy: false });
  try {
    for (let i = 0; i < 60; i++) await app.inject({ method: 'GET', url: '/api/v1/s/missing/doc', remoteAddress: '172.28.0.2', headers: { 'x-forwarded-for': '198.51.100.1' } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/s/missing/doc', remoteAddress: '172.28.0.2', headers: { 'x-forwarded-for': '198.51.100.2' } })).statusCode).toBe(429);
  } finally { await app.close(); }
});

it('A1 stops a forwarded chain at the nearest untrusted hop', async () => {
  vi.stubEnv('TRUST_PROXY', '172.28.0.0/24');
  const app = createApp({ databasePath: ':memory:' });
  const request = (forged: string) => app.inject({ method: 'GET', url: '/api/v1/s/missing/doc', remoteAddress: '172.28.0.2', headers: { 'x-forwarded-for': `${forged}, 203.0.113.8` } });
  try {
    for (let i = 0; i < 60; i++) await request('198.51.100.1');
    expect((await request('198.51.100.2')).statusCode).toBe(429);
  } finally { await app.close(); }
});

it('A1 proxy client login failures do not lock out another client', async () => {
  const app = createApp({ databasePath: ':memory:', trustProxy: '172.28.0.0/24' });
  const login = (email: string, ip: string) => app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '172.28.0.2', headers: { origin: 'http://localhost:5173', 'x-hcd-request': '1', 'x-forwarded-for': ip }, payload: { email, password: 'incorrect-password' } });
  try {
    for (let i = 0; i < 20; i++) expect((await login(`unknown${i}@example.test`, '198.51.100.1')).statusCode).toBe(401);
    expect((await login('first@example.test', '198.51.100.1')).statusCode).toBe(429);
    expect((await login('second@example.test', '198.51.100.2')).statusCode).toBe(401);
  } finally { await app.close(); }
});
