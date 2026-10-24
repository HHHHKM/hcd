import { mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createApp } from '../packages/server/src/app';

const source = process.cwd();
const temp = await mkdtemp(join(tmpdir(), 'hcd-b4-bundle-'));
let child: ChildProcess | undefined;
const secret = 'hcd-b4-local-fixture-secret-'.repeat(3);
const appOrigin = 'https://127.0.0.1';
try {
  const app = createApp({ dataDir: join(temp, 'data'), secretKey: secret, seed: true, exports: { autoStart: false } });
  await app.ready();
  await app.close();
  const entry = (await readdir(join(source, 'node_modules/.pnpm'))).find((name) => name.startsWith('esbuild@'))!;
  const esbuild = join(source, 'node_modules/.pnpm', entry, 'node_modules/esbuild/bin/esbuild');
  for (const [input, output] of [
    ['main.ts', 'main.mjs'],
    ['change-worker.ts', 'change-worker.mjs'],
  ]) {
    execFileSync(
      esbuild,
      [
        join(source, 'packages/server/src', input!),
        '--bundle',
        '--platform=node',
        '--format=esm',
        '--packages=external',
        `--outfile=${join(temp, output!)}`,
      ],
      { stdio: 'pipe' },
    );
  }
  await symlink(join(source, 'node_modules'), join(temp, 'node_modules'));
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Port allocation failed');
  const port = address.port;
  await new Promise<void>((done, reject) => reservation.close((error) => (error ? reject(error) : done())));
  child = spawn(process.execPath, [join(temp, 'main.mjs')], {
    cwd: temp,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      HCD_SEED_DEMO: '0',
      SECRET_KEY: secret,
      APP_URL: appOrigin,
      RENDER_URL: 'https://hcd-b4-render.fixture.test',
      PORT: String(port),
      DATA_DIR: join(temp, 'data'),
      WEB_ROOT: resolve(temp, 'absent-web-root'),
      LOG_LEVEL: 'silent',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Bundled startup timeout')), 10_000);
    let output = '';
    child!.stdout!.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('HCD server listening')) {
        clearTimeout(timer);
        done();
      }
    });
    child!.stderr!.on('data', (chunk) => {
      output += chunk.toString();
    });
    child!.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Bundled server exited ${code}: ${output}`));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const headers = {
    host: new URL(appOrigin).host,
    origin: appOrigin,
    'x-hcd-request': '1',
    'content-type': 'application/json',
  };
  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'd@example.com', password: 'hcd-demo-2026' }),
  });
  if (login.status !== 200) throw new Error(`Bundled login ${login.status}: ${await login.text()}`);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const comparison = await fetch(`${base}/api/v1/docs/d_aaaaaaab/compare?from=1&to=1`, {
    headers: { host: headers.host, cookie },
  });
  const body = (await comparison.json()) as { from: number; to: number; changeSet: { changes: unknown[] } };
  if (comparison.status !== 200 || body.from !== 1 || body.to !== 1 || body.changeSet.changes.length !== 0)
    throw new Error(`Bundled comparison failed: ${JSON.stringify(body)}`);
  process.stdout.write(
    JSON.stringify({
      productionMain: 'main.mjs',
      worker: 'change-worker.mjs',
      localHttpLogin: login.status,
      localHttpCompare: comparison.status,
      changes: body.changeSet.changes.length,
      typescriptFilesPresent: false,
      dockerExecuted: false,
    }) + '\n',
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise<void>((done) => {
      const timer = setTimeout(() => {
        child!.kill('SIGKILL');
        done();
      }, 3000);
      child!.once('exit', () => {
        clearTimeout(timer);
        done();
      });
    });
  }
  await rm(temp, { recursive: true, force: true });
}
