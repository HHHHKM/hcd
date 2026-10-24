import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { createApp, hashTokenForTesting } from '../packages/server/src/app';
import { openDatabase } from '../packages/server/src/db';

const port = 4173;
const directory = mkdtempSync(join(tmpdir(), 'hcd-visual-regression-'));
const db = openDatabase(join(directory, 'hcd.sqlite'));
const secretKey = 'local-visual-regression-secret';
const app = createApp({
  db,
  dataDir: directory,
  seed: true,
  appUrl: `http://127.0.0.1:${port}`,
  secretKey,
  logger: { level: 'silent' },
  exports: { autoStart: false },
});
// Fixed fixture dates keep real application data/API handlers deterministic.
// This database and the viewer token exist only in this disposable directory.
const fixtureTime = '2026-10-24T00:00:00.000Z';
for (const table of ['users', 'spaces', 'documents', 'versions', 'submissions', 'comments'])
  db.prepare(`UPDATE ${table} SET created_at=?`).run(fixtureTime);
db.prepare('UPDATE documents SET updated_at=?').run(fixtureTime);
db.prepare(`INSERT INTO share_links
  (id,doc_id,token_hash,role,version_pin,show_comments,created_by,created_at)
  VALUES(?,?,?,'viewer',1,1,?,?)`).run(
  'sl_visual_v1', 'd_aaaaaaab', hashTokenForTesting(secretKey, 'visual_viewer_v1'),
  'u_owner000000', fixtureTime,
);

let closing: Promise<void> | undefined;
const close = async () => {
  closing ??= (async () => {
    try {
      await app.close();
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  })();
  await closing;
};
process.once('SIGTERM', () => void close().finally(() => process.exit(0)));
process.once('SIGINT', () => void close().finally(() => process.exit(0)));
process.once('exit', () => rmSync(directory, { recursive: true, force: true }));

try {
  await app.register(fastifyStatic, { root: resolve('dist'), prefix: '/', wildcard: false });
  app.setNotFoundHandler((request, reply) =>
    request.headers.accept?.includes('text/html')
      ? reply.type('text/html').sendFile('index.html')
      : reply.code(404).send({ error: { code: 'NOT_FOUND' } }),
  );
  await app.listen({ host: '127.0.0.1', port });
} catch (error) {
  await close();
  throw error;
}
