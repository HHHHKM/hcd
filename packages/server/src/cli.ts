import { configuredMailDelivery } from './outbox';
import { randomBytes, scryptSync } from 'node:crypto';
import { join } from 'node:path';
import { createApp } from './app';
import { openDatabase } from './db';
import { issueInvitation, pendingPasswordHash } from './accounts';

function parseOptions(values: string[]) {
  const options = new Map<string, string>();
  for (let i = 0; i < values.length; i += 1) {
    const flag = values[i];
    if (!flag?.startsWith('--')) continue;
    const next = values[i + 1];
    options.set(flag.slice(2), next && !next.startsWith('--') ? next : 'true');
    if (next && !next.startsWith('--')) i += 1;
  }
  return options;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'mail' && args[0] === 'test') {
  const options = parseOptions(args.slice(1));
  const recipient = options.get('to')?.trim().toLowerCase();
  if (!recipient || recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    process.stderr.write('Usage: pnpm hcd mail test --to recipient@example.com [--locale en]\n');
    process.exitCode = 2;
  } else {
    let delivery: ReturnType<typeof configuredMailDelivery>;
    try {
      delivery = configuredMailDelivery();
      if (!delivery) throw new Error('SMTP_NOT_CONFIGURED');
      const zh = options.get('locale') !== 'en';
      const subject = zh ? 'HCD \u00b7 \u90ae\u4ef6\u914d\u7f6e\u6d4b\u8bd5' : 'HCD \u00b7 Email configuration test';
      const text = zh ? '\u8fd9\u662f HCD \u90ae\u4ef6\u6295\u9012\u6d4b\u8bd5\u3002' : 'This is an HCD email delivery test.';
      await delivery.send({ to: recipient, subject, text, html: `<p>${text}</p>`, messageId: `<hcd-test-${randomBytes(16).toString('hex')}@${new URL(process.env.APP_URL ?? 'http://localhost:5173').hostname}>` });
      process.stdout.write('SMTP server accepted the test email. Check the recipient inbox to confirm delivery.\n');
    } catch {
      process.stderr.write('Email test failed. Check SMTP configuration, connectivity, and sender permissions.\n');
      process.exitCode = 1;
    } finally { delivery?.close?.(); }
  }
} else if (command === 'seed' && args[0] === 'demo') {
  const app = createApp({ seed: true });
  await app.close();
  process.stdout.write('Demo seed is ready.\n');
} else if (command === 'admin' && (args[0] === 'create' || args[0] === 'reset-link')) {
  const operation = args[0];
  const options = parseOptions(args.slice(1));
  const email = options.get('email')?.trim().toLowerCase();
  const name = options.get('name')?.trim().slice(0, 100);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (operation === 'create' && !name)) {
    process.stderr.write(`Usage: pnpm hcd admin ${operation} --email user@example.com${operation === 'create' ? ' --name "Name"' : ''}\n`);
    process.exitCode = 2;
  } else {
    const db = openDatabase(process.env.DATABASE_PATH ?? join(process.env.DATA_DIR ?? './data', 'hcd.sqlite'));
    try {
      const secretKey = process.env.SECRET_KEY ?? 'development-only-secret-key-change-me';
      if (process.env.NODE_ENV === 'production' && (secretKey.length < 32 || !process.env.SECRET_KEY || secretKey.includes('replace-this'))) throw new Error('Set SECRET_KEY to the same production secret used by the server.');
      const invite = db.transaction(() => {
        let user = db.prepare('SELECT id,disabled_at FROM users WHERE email=?').get(email) as { id: string; disabled_at: string | null } | undefined;
        if (operation === 'create') {
          if (user) throw new Error('An account with this email already exists. Use admin reset-link for a password reset.');
          user = { id: `u_${randomBytes(8).toString('hex').slice(0, 12)}`, disabled_at: null };
          db.prepare('INSERT INTO users(id,email,name,password_hash,locale,is_admin,created_at) VALUES(?,?,?,?,?,1,?)')
            .run(user.id, email, name!, pendingPasswordHash, 'zh-CN', new Date().toISOString());
        }
        if (!user || user.disabled_at) throw new Error('An active account with this email was not found.');
        return issueInvitation(db, user.id, operation === 'create' ? 'invite' : 'reset', 'cli', {
          secretKey, appUrl: process.env.APP_URL ?? 'http://localhost:5173',
        });
      })();
      process.stdout.write(`${operation === 'create' ? 'Administrator invitation' : 'Password reset'} for ${email} (expires ${invite.expiresAt}):\n${invite.url}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'Unable to issue invitation.'}\n`);
      process.exitCode = 1;
    } finally { db.close(); }
  }
} else if (command === 'user:add') {
  const options = parseOptions(args);
  const email = options.get('email')?.trim().toLowerCase();
  const name = options.get('name')?.trim();
  const password = options.get('password');
  if (!email || !name || !password || password.length < 10) {
    process.stderr.write('Usage: pnpm hcd user:add --email user@example.com --name "Name" --password "at-least-10-chars" [--admin]\n');
    process.exitCode = 2;
  } else {
    const db = openDatabase(process.env.DATABASE_PATH ?? join(process.env.DATA_DIR ?? './data', 'hcd.sqlite'));
    try {
      const isAdmin = options.get('admin') === 'true';
      if (isAdmin && (db.prepare('SELECT 1 FROM users WHERE is_admin=1 AND disabled_at IS NULL LIMIT 1').get())) throw new Error('An active administrator already exists. Use the admin invite workflow to grant access.');
      const salt = randomBytes(16).toString('base64url');
      const digest = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
      const id = `u_${randomBytes(8).toString('hex').slice(0, 12)}`;
      db.prepare('INSERT INTO users(id,email,name,password_hash,locale,is_admin,created_at) VALUES(?,?,?,?,?,?,?)').run(id, email, name, `${salt}:${digest}`, 'zh-CN', Number(isAdmin), new Date().toISOString());
      process.stdout.write(`Created ${email}${isAdmin ? ' as administrator' : ''}.\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'Unable to create user.'}\n`);
      process.exitCode = 1;
    } finally { db.close(); }
  }
} else {
  process.stderr.write('Commands: mail test --to [--locale en] | seed demo | admin create --email --name | admin reset-link --email | user:add --email --name --password [--admin]\n');
  process.exitCode = 2;
}
