/** D2 acceptance: real CLI device login, browser approval, then a real MCP stdio child. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium, type Browser } from 'playwright';
import { createApp } from '../packages/server/src/app';
import { openDatabase } from '../packages/server/src/db';
import { registerMcpRoutes } from '../packages/server/src/mcp';
import { PERSONAL_ACCESS_TOKEN_PATTERN } from '../packages/core/src/tokens';

const project = resolve(import.meta.dirname, '..');
const outputs = join(project, 'outputs');
const started = new Date().toISOString();
const log: string[] = [];
const record = (value: string) => {
  const line = `${new Date().toISOString()} ${value}`;
  log.push(line);
  process.stdout.write(`${line}\n`);
};
const safeError = (reason: unknown) =>
  (reason instanceof Error ? reason.message : String(reason))
    .replace(/hcd_pat_[A-Za-z0-9_-]+/g, '[redacted PAT]')
    .replace(/hcd_session=[^;\s]+/g, 'hcd_session=[redacted]');

async function unusedPort() {
  const probe = createServer();
  await new Promise<void>((done, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', done);
  });
  const address = probe.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((done, reject) => probe.close((error) => (error ? reject(error) : done())));
  return address.port;
}

async function exitOf(child: ChildProcess, milliseconds = 60_000) {
  return await new Promise<number | null>((done, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('CLI child exceeded acceptance timeout'));
    }, milliseconds);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      done(code);
    });
  });
}

await mkdir(outputs, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'hcd-cli-d2-'));
const db = openDatabase(join(temporary, 'acceptance.sqlite'));
const port = await unusedPort();
const origin = `http://127.0.0.1:${port}`;
const app = createApp({
  db,
  seed: true,
  appUrl: origin,
  dataDir: join(temporary, 'data'),
  secretKey: randomBytes(32).toString('hex'),
  logger: { level: 'silent' },
  exports: { autoStart: false },
  mailDelivery: async () => {
    throw new Error('External mail is disabled in the local acceptance fixture');
  },
});
registerMcpRoutes(app, { appUrl: origin });
const webRoot = join(project, 'dist');
await app.register(fastifyStatic, { root: webRoot, prefix: '/', wildcard: false });
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
  return reply.type('text/html').sendFile('index.html');
});

let browser: Browser | undefined;
let login: ChildProcess | undefined;
let client: Client | undefined;
let passed = false;
let browserVersion = '';
let protocolServer = '';
let toolsCount = 0;
let externalBrowserRequests = 0;
let errorText = '';
const credentialFile = join(temporary, 'profile', '.config', 'mdoc', 'credentials.json');
try {
  // Only redirect os.homedir() inside the CLI processes. The user's HOME and
  // actual ~/.config/mdoc stay untouched; authorization and CLI code are real.
  const credentialShim = join(temporary, 'credential-location.cjs');
  await writeFile(
    credentialShim,
    "require('node:os').homedir = () => process.env.HCD_ACCEPTANCE_CREDENTIAL_ROOT;\n" +
      "require('node:module').syncBuiltinESMExports();\n",
    { mode: 0o600 },
  );
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && !['HCD_TOKEN', 'NODE_OPTIONS'].includes(entry[0]),
    ),
  );
  childEnv.HCD_ACCEPTANCE_CREDENTIAL_ROOT = join(temporary, 'profile');
  childEnv.NODE_OPTIONS = `--require=${credentialShim}`;
  await app.listen({ port, host: '127.0.0.1' });
  record('Fresh temporary SQLite database and loopback HTTP application started.');

  login = spawn('pnpm', ['mdoc', 'login', origin, '--no-open'], {
    cwd: project,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const loginExited = exitOf(login);
  let loginStdout = '';
  let loginStderr = '';
  login.stdout!.on('data', (chunk) => (loginStdout += String(chunk)));
  login.stderr!.on('data', (chunk) => (loginStderr += String(chunk)));
  const verifyUrl = await new Promise<string>((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('CLI did not print a device verification URL')), 20_000);
    const read = () => {
      const found = /Open (http:\/\/127\.0\.0\.1:\d+\/cli-auth\?code=[A-Z2-9-]+)/.exec(loginStdout)?.[1];
      if (found) {
        clearTimeout(timeout);
        done(found);
      }
    };
    login!.stdout!.on('data', read);
    login!.once('exit', (code) => {
      if (!/Open http:/.test(loginStdout)) {
        clearTimeout(timeout);
        reject(new Error(`CLI exited before requesting device approval (${code})`));
      }
    });
    read();
  });
  assert.equal(new URL(verifyUrl).origin, origin);
  record('Actual pnpm mdoc login requested device authorization; no --token or HCD_TOKEN was supplied.');

  browser = await chromium.launch({
    executablePath: process.env.HCD_ACCEPTANCE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  browserVersion = browser.version();
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    externalBrowserRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(verifyUrl);
  await page.locator('input[type="email"]').fill('d@example.com');
  await page.locator('input[type="password"]').fill('hcd-demo-2026');
  await page.locator('button.auth-submit').click();
  await page.locator('.cli-auth-code').waitFor();
  assert.equal((await page.locator('.cli-auth-code').innerText()).trim(), new URL(verifyUrl).searchParams.get('code'));
  for (const checkbox of await page.locator('.cli-auth-options').first().locator('input[type="checkbox"]').all()) {
    await checkbox.uncheck();
  }
  await page.locator('.cli-auth-options').first().locator('input[type="checkbox"]').first().check();
  const fixtureDocument = db.prepare('SELECT title FROM documents WHERE ai_enabled=1 LIMIT 1').get() as {
    title: string;
  };
  await page
    .locator('.cli-auth-document-list label')
    .filter({ hasText: fixtureDocument.title })
    .locator('input')
    .check();
  await page.locator('.cli-auth-confirm input').check();
  await page.locator('.cli-auth-actions .button-primary').click();
  await page.locator('.cli-auth-result').waitFor();
  assert.match(await page.locator('.cli-auth-result').innerText(), /approved|已批准|已允许/i);
  await page.screenshot({ path: join(outputs, 'cli-authorization.png'), fullPage: true });
  record(
    `Real Chrome ${browserVersion}: signed in, matched the terminal code, selected read scope + one document, approved.`,
  );

  assert.equal(await loginExited, 0);
  assert.match(loginStdout, /Saved credentials for/);
  const credentials = JSON.parse(await readFile(credentialFile, 'utf8')) as {
    servers: Array<{ server: string; token: string; tokenId: string }>;
  };
  assert.equal(credentials.servers.length, 1);
  const credential = credentials.servers[0]!;
  assert.equal(credential.server, origin);
  assert(PERSONAL_ACCESS_TOKEN_PATTERN.test(credential.token));
  assert.equal((await stat(credentialFile)).mode & 0o777, 0o600);
  assert(!loginStdout.includes(credential.token) && !loginStderr.includes(credential.token));
  record('Device poll completed; CLI saved a 32-base32 hcd_pat_ token with file mode 0600. Credential values omitted.');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', join(project, 'packages/cli/src/index.ts'), 'mcp', '--server', origin],
    env: childEnv,
    cwd: project,
    stderr: 'pipe',
  });
  let mcpStderr = '';
  transport.stderr?.on('data', (chunk) => (mcpStderr += String(chunk)));
  client = new Client({ name: 'd2-cli-browser-acceptance', version: '1' });
  await client.connect(transport);
  protocolServer = client.getServerVersion()?.name ?? '';
  const tools = await client.listTools();
  toolsCount = tools.tools.length;
  assert(toolsCount > 10);
  const documentId = (
    db.prepare('SELECT doc_ids FROM api_tokens WHERE id=?').get(credential.tokenId) as {
      doc_ids: string;
    }
  ).doc_ids;
  const selectedDocument = (JSON.parse(documentId) as string[])[0]!;
  const result = await client.callTool({ name: 'read_document', arguments: { documentId: selectedDocument } });
  assert.equal(result.isError, false);
  assert.equal(
    (result.structuredContent as { untrustedData: { doc: { id: string } } }).untrustedData.doc.id,
    selectedDocument,
  );
  assert(!mcpStderr.includes(credential.token));
  record(
    `Actual CLI mcp stdio child initialized (${protocolServer}); tools/list returned ${toolsCount} tools; read_document succeeded.`,
  );
  await client.close();
  client = undefined;
  assert.equal(mcpStderr, '');
  assert.equal(externalBrowserRequests, 0);
  passed = true;
} catch (reason) {
  errorText = safeError(reason);
  record(`FAIL: ${errorText}`);
  process.exitCode = 1;
} finally {
  if (client) await client.close().catch(() => undefined);
  if (login && login.exitCode === null) login.kill('SIGTERM');
  if (browser) await browser.close();
  await app.close();
  db.close();
  await rm(temporary, { recursive: true, force: true });
  record(
    'Closed MCP/browser/HTTP processes and removed the temporary database, browser context, and CLI credential profile.',
  );
  await writeFile(join(outputs, 'cli-acceptance.log'), `${log.join('\n')}\n`);
  await writeFile(
    join(outputs, 'cli-acceptance.md'),
    `# D2 CLI acceptance\n\n` +
      `- Started: ${started}\n- Result: ${passed ? 'PASS' : 'FAIL'}\n` +
      `- Command: \`pnpm exec tsx scripts/acceptance-cli.ts\` (requires loopback listener and Chrome execution permissions).\n` +
      `- Actual login: \`pnpm mdoc login <loopback-origin> --no-open\`; default 3-second device polling, no token override.\n` +
      `- Consent: real Google Chrome ${browserVersion || '(not completed)'}, application built from local dist; login and approval clicked through the actual page, not API consent injection.\n` +
      `- Actual MCP: \`node --import tsx packages/cli/src/index.ts mcp --server <loopback-origin>\`; saved credentials read by the CLI.\n` +
      `- MCP initialize: ${passed ? `PASS (${protocolServer})` : 'see failure'}; tools/list: ${toolsCount}; read_document: ${passed ? 'PASS' : 'see failure'}.\n` +
      `- PAT: shared format validated; exact value omitted; credentials.json mode 0600.\n` +
      `- Isolation: fresh temporary SQLite DB, development demo seed, isolated CLI credential profile via a subprocess-only os.homedir shim; HOME unchanged. No real external service used.\n` +
      `- Browser requests outside the loopback application: ${externalBrowserRequests} (blocked if attempted).\n` +
      `- Cleanup: browser, stdio child, HTTP listener, temporary DB and credential profile removed in finally.\n` +
      `- Evidence: cli-acceptance.log; cli-authorization.png (approval result, no PAT or cookie).\n` +
      (errorText ? `- Failure: ${errorText}\n` : '') +
      `\nThis is an executed local CLI/browser acceptance, separate from Vitest test totals.\n`,
  );
}
