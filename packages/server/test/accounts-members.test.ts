import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { openDatabase, type HcdDatabase } from '../src/db';

const origin = 'http://localhost:5173';
const headers = (cookie = '') => ({ cookie, origin, 'x-hcd-request': '1' });
const tokenFrom = (url: string) => new URL(url).pathname.split('/').pop()!;

describe('accounts and membership', () => {
  let app: FastifyInstance;
  let db: HcdDatabase;
  beforeEach(async () => {
    db = openDatabase(':memory:');
    app = createApp({ db, seed: true, secretKey: 'account-integration-secret', appUrl: origin });
    await app.ready();
  });
  afterEach(async () => { await app.close(); db.close(); });

  async function login(email: string, password = 'hcd-demo-2026') {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: headers(), payload: { email, password } });
    expect(response.statusCode).toBe(200);
    return String(response.headers['set-cookie']).split(';')[0]!;
  }
  async function invite(cookie: string, email: string) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers: headers(cookie), payload: { email, name: 'Invited Reader' } });
    expect(response.statusCode).toBe(201);
    return response.json() as { user: { id: string; email: string }; inviteUrl: string; expiresAt: string };
  }

  it('AT-11 stores invite hashes and atomically redeems one-use seven-day invitations', async () => {
    const admin = await login('admin@example.com');
    const created = await invite(admin, 'New.Reader@Example.com');
    const raw = tokenFrom(created.inviteUrl);
    expect(created.user.email).toBe('new.reader@example.com');
    expect(Date.parse(created.expiresAt) - Date.now()).toBeGreaterThan(6.9 * 86400000);
    const row = db.prepare('SELECT token_hash,used_at FROM invites WHERE user_id=?').get(created.user.id) as { token_hash: string; used_at: string | null };
    expect(row.token_hash).not.toBe(raw);
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.used_at).toBeNull();
    const preview = await app.inject({ method: 'GET', url: `/api/v1/auth/invites/${raw}` });
    expect(preview.json()).toEqual({ kind: 'invite', email: created.user.email, name: 'Invited Reader' });
    const noMarker = await app.inject({ method: 'POST', url: `/api/v1/auth/invites/${raw}/accept`, payload: { name: 'New Reader', password: 'a-safe-long-password' } });
    expect(noMarker.statusCode).toBe(403);
    const weak = await app.inject({ method: 'POST', url: `/api/v1/auth/invites/${raw}/accept`, headers: headers(), payload: { name: 'New Reader', password: 'short' } });
    expect(weak.statusCode).toBe(400);
    const accepted = await app.inject({ method: 'POST', url: `/api/v1/auth/invites/${raw}/accept`, headers: headers(), payload: { name: 'New Reader', password: 'a-safe-long-password' } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().user.name).toBe('New Reader');
    expect(accepted.headers['set-cookie']).toBeTruthy();
    const duplicate = await app.inject({ method: 'POST', url: `/api/v1/auth/invites/${raw}/accept`, headers: headers(), payload: { name: 'Other', password: 'different-long-password' } });
    expect(duplicate.statusCode).toBe(410);
    expect(duplicate.json().error.code).toBe('INVITE_INVALID');
    expect((await app.inject({ method: 'GET', url: `/api/v1/auth/invites/${raw}` })).statusCode).toBe(410);
    await login(created.user.email, 'a-safe-long-password');
    const expired = await invite(admin, 'expired@example.com');
    db.prepare('UPDATE invites SET expires_at=? WHERE user_id=?').run('2000-01-01T00:00:00.000Z', expired.user.id);
    const gone = await app.inject({ method: 'POST', url: `/api/v1/auth/invites/${tokenFrom(expired.inviteUrl)}/accept`, headers: headers(), payload: { name: 'Expired', password: 'a-safe-long-password' } });
    expect(gone.statusCode).toBe(410);
  });

  it('AT-11 replaces reset links and resets only the password while revoking old sessions', async () => {
    const admin = await login('admin@example.com');
    const editor = await login('a@example.com');
    const reset = async () => {
      const response = await app.inject({ method: 'POST', url: '/api/v1/admin/users/u_editor00000/reset-link', headers: headers(admin) });
      expect(response.statusCode).toBe(200);
      expect(Date.parse(response.json().expiresAt) - Date.now()).toBeGreaterThan(23.9 * 3600000);
      return tokenFrom(response.json().resetUrl);
    };
    const first = await reset();
    const second = await reset();
    expect((await app.inject({ method: 'GET', url: `/api/v1/auth/invites/${first}` })).statusCode).toBe(410);
    const accepted = await app.inject({ method: 'POST', url: `/api/v1/auth/invites/${second}/accept`, headers: headers(), payload: { name: 'Do not rename', password: 'reset-long-password' } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().user.name).toBe('周予安');
    expect((await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: editor } })).statusCode).toBe(401);
    await login('a@example.com', 'reset-long-password');
  });

  it('AT-11 restricts administrator actions and immediately invalidates disabled users sessions ' +
     'and PATs', async () => {
    const admin = await login('admin@example.com');
    const editor = await login('a@example.com');
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/users' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: { cookie: editor } })).statusCode).toBe(403);
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: { cookie: admin } });
    expect(list.statusCode).toBe(200);
    expect(list.json().users).toHaveLength(7);
    expect(JSON.stringify(list.json())).not.toContain('password_hash');
    const search = await app.inject({ method: 'GET', url: '/api/v1/users?q=%E5%91%A8', headers: { cookie: admin } });
    expect(search.statusCode).toBe(200);
    expect(search.json().items).toHaveLength(1);
    expect(search.json().items[0].email).toBe('a@example.com');
    const literalWildcard = await app.inject({ method: 'GET', url: '/api/v1/users?q=%25', headers: { cookie: admin } });
    expect(literalWildcard.json().items).toHaveLength(0);
    const adminPat = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(admin), payload: { name: 'admin read', scopes: ['read'] } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: { authorization: `Bearer ${adminPat.json().token}` } })).statusCode).toBe(403);
    const lastAdmin = await app.inject({ method: 'PATCH', url: '/api/v1/admin/users/u_admin000000', headers: headers(admin), payload: { disabled: true } });
    expect(lastAdmin.statusCode).toBe(409);
    expect(lastAdmin.json().error.code).toBe('LAST_ADMIN');
    const pat = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(editor), payload: { name: 'reader', scopes: ['read'] } });
    const disabled = await app.inject({ method: 'PATCH', url: '/api/v1/admin/users/u_editor00000', headers: headers(admin), payload: { disabled: true } });
    expect(disabled.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: editor } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/docs', headers: { authorization: `Bearer ${pat.json().token}` } })).statusCode).toBe(401);
    expect(db.prepare('SELECT 1 FROM sessions WHERE user_id=?').get('u_editor00000')).toBeUndefined();
    const revoked = db.prepare('SELECT revoked_at FROM api_tokens WHERE user_id=?').get('u_editor00000') as { revoked_at: string };
    expect(revoked.revoked_at).toBeTruthy();
    const enable = await app.inject({ method: 'PATCH', url: '/api/v1/admin/users/u_editor00000', headers: headers(admin), payload: { disabled: false } });
    expect(enable.statusCode).toBe(200);
    await login('a@example.com');
    expect((await app.inject({ method: 'GET', url: '/api/v1/docs', headers: { authorization: `Bearer ${pat.json().token}` } })).statusCode).toBe(401);
  });

  it('AT-11 manages space members while protecting the last owner against deletion and demotion', async () => {
    const owner = await login('d@example.com');
    const editor = await login('a@example.com');
    const put = (userId: string, role: string, cookie = owner) => app.inject({ method: 'PUT', url: `/api/v1/spaces/sp_demo000000/members/${userId}`, headers: headers(cookie), payload: { role } });
    expect((await put('u_owner000000', 'viewer')).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/spaces/sp_demo000000/members/u_owner000000', headers: headers(owner) })).statusCode).toBe(409);
    expect((await put('u_comment000', 'editor', editor)).statusCode).toBe(403);
    expect((await put('u_comment000', 'bogus')).statusCode).toBe(400);
    expect((await put('u_missing', 'viewer')).statusCode).toBe(404);
    expect((await put('u_editor00000', 'owner')).statusCode).toBe(204);
    expect((await put('u_owner000000', 'viewer')).statusCode).toBe(204);
    const members = await app.inject({ method: 'GET', url: '/api/v1/spaces/sp_demo000000/members', headers: { cookie: editor } });
    expect(members.statusCode).toBe(200);
    expect(members.json().members.find((member: { id: string }) => member.id === 'u_owner000000').role).toBe('viewer');
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/spaces/sp_demo000000/members/u_owner000000', headers: headers(editor) })).statusCode).toBe(204);
    const token = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(editor), payload: { scopes: ['submit'] } });
    const blocked = await app.inject({ method: 'PUT', url: '/api/v1/spaces/sp_demo000000/members/u_comment000', headers: { ...headers(), authorization: `Bearer ${token.json().token}` }, payload: { role: 'owner' } });
    expect(blocked.statusCode).toBe(403);
  });

  it('AT-11 lists inherited document roles and prevents member changes through non-owners or PATs', async () => {
    const owner = await login('d@example.com');
    const editor = await login('a@example.com');
    const put = (userId: string, role: string, cookie = owner) => app.inject({ method: 'PUT', url: `/api/v1/docs/d_aaaaaaab/members/${userId}`, headers: headers(cookie), payload: { role } });
    expect((await put('u_owner000000', 'editor')).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/docs/d_aaaaaaab/members/u_owner000000', headers: headers(owner) })).statusCode).toBe(409);
    expect((await put('u_comment000', 'owner', editor)).statusCode).toBe(403);
    expect((await put('u_editor00000', 'viewer')).statusCode).toBe(204);
    const members = await app.inject({ method: 'GET', url: '/api/v1/docs/d_aaaaaaab/members', headers: { cookie: owner } });
    expect(members.statusCode).toBe(200);
    const effective = members.json().members.find((member: { id: string }) => member.id === 'u_editor00000');
    expect(effective).toMatchObject({ documentRole: 'viewer', spaceRole: 'editor', role: 'editor', inherited: true });
    expect((await put('u_editor00000', 'owner')).statusCode).toBe(204);
    expect((await put('u_owner000000', 'editor')).statusCode).toBe(204);
    const token = await app.inject({ method: 'POST', url: '/api/v1/me/tokens', headers: headers(editor), payload: { scopes: ['submit'] } });
    const blocked = await app.inject({ method: 'DELETE', url: '/api/v1/docs/d_aaaaaaab/members/u_comment000', headers: { ...headers(), authorization: `Bearer ${token.json().token}` } });
    expect(blocked.statusCode).toBe(403);
  });

  it('AT-11 returns effective roles consistently in document and space lists after membership ' +
     'changes', async () => {
    const admin = await login('admin@example.com');
    const owner = await login('d@example.com');
    const editor = await login('a@example.com');
    const roles = async (cookie: string) => {
      const docs = await app.inject({ method: 'GET', url: '/api/v1/docs', headers: { cookie } });
      const spaces = await app.inject({ method: 'GET', url: '/api/v1/spaces', headers: { cookie } });
      return { doc: docs.json().docs[0].role, space: spaces.json().spaces[0].role };
    };
    expect(await roles(admin)).toEqual({ doc: 'owner', space: 'owner' });
    expect(await roles(owner)).toEqual({ doc: 'owner', space: 'owner' });
    expect(await roles(editor)).toEqual({ doc: 'editor', space: 'editor' });
    const change = await app.inject({ method: 'PUT', url: '/api/v1/docs/d_aaaaaaab/members/u_editor00000', headers: headers(owner), payload: { role: 'viewer' } });
    expect(change.statusCode).toBe(204);
    expect(await roles(editor)).toEqual({ doc: 'editor', space: 'editor' });
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/docs/d_aaaaaaab/members/u_editor00000', headers: headers(owner) })).statusCode).toBe(204);
    expect(await roles(editor)).toEqual({ doc: 'editor', space: 'editor' });
    expect((await app.inject({ method: 'PUT', url: '/api/v1/spaces/sp_demo000000/members/u_editor00000', headers: headers(owner), payload: { role: 'viewer' } })).statusCode).toBe(204);
    expect(await roles(editor)).toEqual({ doc: 'viewer', space: 'viewer' });
    const writeAfterDemotion = await app.inject({ method: 'PUT', url: '/api/v1/docs/d_aaaaaaab/draft', headers: headers(editor), payload: { baseVersion: 1, content: {} } });
    expect(writeAfterDemotion.statusCode).toBe(403);
  });

  it('AT-11 requires ownership transfer before disabling the final active owner', async () => {
    const admin = await login('admin@example.com');
    const disable = () => app.inject({ method: 'PATCH', url: '/api/v1/admin/users/u_owner000000', headers: headers(admin), payload: { disabled: true } });
    expect((await disable()).json().error.code).toBe('LAST_OWNER');
    expect((db.prepare('SELECT disabled_at FROM users WHERE id=?').get('u_owner000000') as { disabled_at: string | null }).disabled_at).toBeNull();
    const ownedDocuments = db.prepare("SELECT doc_id FROM document_members WHERE user_id=? AND role='owner'").all('u_owner000000') as Array<{ doc_id: string }>;
    for (const resource of ['spaces/sp_demo000000', ...ownedDocuments.map((row) => `docs/${row.doc_id}`)]) {
      expect((await app.inject({ method: 'PUT', url: `/api/v1/${resource}/members/u_editor00000`, headers: headers(admin), payload: { role: 'owner' } })).statusCode).toBe(204);
    }
    expect((await disable()).statusCode).toBe(200);
    // Removing an already disabled owner must not count as removing the remaining active owner.
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/spaces/sp_demo000000/members/u_owner000000', headers: headers(admin) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/spaces/sp_demo000000/members/u_editor00000', headers: headers(admin) })).json().error.code).toBe('LAST_OWNER');
  });
});

describe('administrator CLI invitations', () => {
  it('AT-11 creates a bootstrap administrator and issues redeemable reset links without storing ' +
     'raw tokens', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hcd-admin-cli-'));
    let app: FastifyInstance | undefined;
    let db: HcdDatabase | undefined;
    const secretKey = 'cli-account-integration-secret';
    const run = (...args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', 'packages/server/src/cli.ts', 'admin', ...args], {
      cwd: process.cwd(), env: { ...process.env, DATA_DIR: dataDir, DATABASE_PATH: join(dataDir, 'hcd.sqlite'), SECRET_KEY: secretKey, APP_URL: origin }, encoding: 'utf8',
    });
    try {
      const output = run('create', '--email', 'First.Admin@Example.com', '--name', 'First Admin');
      const inviteUrl = output.match(/http:\/\/localhost:5173\/invite\/\S+/)?.[0];
      expect(inviteUrl).toBeTruthy();
      db = openDatabase(join(dataDir, 'hcd.sqlite'));
      const user = db.prepare('SELECT id,is_admin FROM users WHERE email=?').get('first.admin@example.com') as { id: string; is_admin: number };
      expect(user.is_admin).toBe(1);
      app = createApp({ db, secretKey, appUrl: origin });
      const accepted = await app.inject({ method: 'POST', url: `/api/v1/auth/invites/${tokenFrom(inviteUrl!)}/accept`, headers: headers(), payload: { name: 'First Admin', password: 'bootstrap-long-password' } });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().user.isAdmin).toBe(true);
      const resetOutput = run('reset-link', '--email', 'first.admin@example.com');
      const resetUrl = resetOutput.match(/http:\/\/localhost:5173\/reset\/\S+/)?.[0];
      expect(resetUrl).toBeTruthy();
      const stored = db.prepare('SELECT token_hash FROM invites WHERE user_id=? AND kind=?').get(user.id, 'reset') as { token_hash: string };
      expect(stored.token_hash).not.toBe(tokenFrom(resetUrl!));
      expect((await app.inject({ method: 'POST', url: `/api/v1/auth/invites/${tokenFrom(resetUrl!)}/accept`, headers: headers(), payload: { password: 'replacement-long-password' } })).statusCode).toBe(200);
    } finally {
      if (app) await app.close();
      db?.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 15000);
});
