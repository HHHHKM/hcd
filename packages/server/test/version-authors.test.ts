import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app';

it('B1 returns the author name in both version history APIs', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hcd-version-author-'));
  const app = createApp({ dataDir, databasePath: join(dataDir, 'hcd.sqlite'), seed: true });
  try {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-hcd-request': '1' }, payload: { email: 'd@example.com', password: 'hcd-demo-2026' } });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const history = await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/versions', headers: { cookie } });
    expect(history.statusCode).toBe(200);
    expect(history.json().versions[0]).toMatchObject({ version: 1, authorName: '林知夏' });
    const snapshot = await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/versions/1', headers: { cookie } });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().version).toMatchObject({ number: 1, authorName: '林知夏' });
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
