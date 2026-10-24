#!/usr/bin/env node
import { PERSONAL_ACCESS_TOKEN_PATTERN } from '../../core/src/tokens';
import { compareDocumentChanges } from '../../core/src/changes';
import { formatChanges } from './change-format';
import { cancelWithReceipt, inspectSubmissionReceipts, submitWithReceipt, requestFingerprint, type CancellationResponse } from './submission-receipts';
import { randomUUID } from 'node:crypto';
import { prepareSubmissionPlan } from './submission-plan';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { normalizeServer, readCredentials, removeCredential, saveCredential, type Credential } from './credentials';
import { loginWithDevice, revokeCredential } from './device-login';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCounterTmpIdSource, diffDocuments, serializeModule, validateDocument, type Document, type Module } from '../../core/src/index';

type SyncInfo = { version: 1; server: string; documentId: string; baseVersion: number; title: string; files: Array<{ id: string; name: string }> };
export type LocalStatus = { added: string[]; modified: string[]; deleted: string[]; moved: string[]; renamed: string[]; warnings: string[]; modules: Module[] };

const terminalText = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
const docConfigPath = (root: string): string => join(root, '.mdoc', 'doc.json');
export function safeModuleFilename(index: number, title: string, used = new Set<string>()): string {
  const slug = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 40) || 'module';
  const base = `${String(index + 1).padStart(2, '0')}-${slug}`;
  let name = `${base}.html`; let suffix = 2;
  while (used.has(name.toLocaleLowerCase())) name = `${base}-${suffix++}.html`;
  used.add(name.toLocaleLowerCase());
  return name;
}

async function readLocalSources(root: string): Promise<Array<{ name: string; html: string }>> {
  const entries = (await readdir(root, { withFileTypes: true })).filter(entry => entry.name.toLowerCase().endsWith('.html'));
  if (entries.some(entry => !entry.isFile())) throw new Error('Local HTML modules must be ordinary files; symlinks and directories cannot be submitted.');
  const names = entries.map(entry => entry.name).sort((a, b) => a.localeCompare(b));
  return Promise.all(names.map(async name => ({ name, html: await readFile(join(root, name), 'utf8') })));
}

export async function compareLocalModules(rootPath: string, info: SyncInfo, base: Document, snapshot?: Array<{ name: string; html: string }>): Promise<LocalStatus> {
  const sourceSnapshot = snapshot ?? await readLocalSources(resolve(rootPath));
  const plan = prepareSubmissionPlan({ base, sourceSnapshot, files: info.files });
  return { ...plan.status, modules: plan.document.modules };
}

async function loadSync(rootPath = process.cwd()): Promise<{ root: string; info: SyncInfo; base: Document }> {
  const root = resolve(rootPath);
  const info = JSON.parse(await readFile(docConfigPath(root), 'utf8')) as SyncInfo;
  const base = JSON.parse(await readFile(join(root, '.mdoc', 'base', 'document.json'), 'utf8')) as Document;
  if (!Array.isArray(info.files) || info.files.some((file) => typeof file.name !== 'string' || file.name !== basename(file.name) || !/\.html$/i.test(file.name) || !/^m_[a-z2-7]{8}$/.test(file.id)) || new Set(info.files.map((file) => file.name)).size !== info.files.length) throw new Error('Invalid .mdoc file inventory.');
  if (!validateDocument(base).ok || info.version !== 1 || info.documentId !== base.id) throw new Error('Unsupported or inconsistent .mdoc document metadata.');
  return { root, info, base };
}

async function api<T>(credential: Credential, path: string, options: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const response = await fetch(`${credential.server}/api/v1${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: {
      authorization: `Bearer ${credential.token}`,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(method === 'GET' ? {} : { 'x-hcd-request': '1' }),
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  if (!response.ok) {
    // Error bodies are remote input and can echo credentials or terminal controls.
    await response.body?.cancel();
    throw new Error(`HCD request failed (${response.status}).`);
  }
  return (response.status === 204 ? undefined : response.json()) as Promise<T>;
}

async function credentialFor(server?: string): Promise<Credential> {
  const credentials = await readCredentials();
  const selected = server ? normalizeServer(server) : undefined;
  const value = credentials.servers.find((item) => item.server === selected) ?? (selected ? undefined : credentials.servers.at(-1));
  if (!value) throw new Error('Not logged in. Run `mdoc login <server>` or supply a personal token with --token.');
  return value;
}

export async function pullDocument(server: string, token: string, documentId: string, target = '.', force = false): Promise<void> {
  const credential: Credential = { server: normalizeServer(server), token, savedAt: new Date().toISOString() };
  const { doc, content } = await api<{ doc: { currentVersion: number; title: string }; content: Document }>(credential, `/docs/${encodeURIComponent(documentId)}`);
  if (!validateDocument(content).ok || content.id !== documentId || !Number.isInteger(doc.currentVersion) || doc.currentVersion < 1) throw new Error('Server returned an invalid document snapshot.');
  const root = resolve(target);
  const config = docConfigPath(root);
  let existingInfo: SyncInfo | undefined;
  try {
    const existing = await loadSync(root);
    existingInfo = existing.info;
    const status = force ? undefined : await compareLocalModules(root, existing.info, existing.base);
    if (status && (status.added.length || status.modified.length || status.deleted.length || status.moved.length || status.renamed.length)) throw new Error('Local changes found. Re-run with --force to replace the folder contents.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const entries = await readdir(root).catch((reason) => { if (reason.code === 'ENOENT') return []; throw reason; });
    if (entries.length) throw new Error('Target directory is not an initialized HCD checkout and is not empty. Choose a new directory.');
  }
  for (const folder of [join(root, '.mdoc'), join(root, '.mdoc', 'base')]) {
    const existing = await lstat(folder).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('HCD metadata must be stored in ordinary directories.');
  }
  await mkdir(join(root, '.mdoc', 'base'), { recursive: true });
  await mkdir(root, { recursive: true });
  if (existingInfo) {
    const removed = force ? (await readdir(root, { withFileTypes: true })).filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && /\.html$/i.test(entry.name)).map((entry) => entry.name) : existingInfo.files.map((file) => file.name);
    for (const name of removed) await rm(join(root, name), { force: true });
    for (const file of existingInfo.files) await rm(join(root, '.mdoc', 'base', file.name), { force: true });
  }
  const usedNames = new Set<string>();
  const files: SyncInfo['files'] = [];
  for (const [index, module] of content.modules.entries()) {
    const name = safeModuleFilename(index, module.title, usedNames);
    files.push({ id: module.id, name });
    const html = `${serializeModule(module)}\n`;
    await writeFile(join(root, name), html, 'utf8');
    await writeFile(join(root, '.mdoc', 'base', name), html, 'utf8');
  }
  const info: SyncInfo = { version: 1, server: credential.server, documentId: content.id, baseVersion: doc.currentVersion, title: content.title, files };
  await writeFile(join(root, '.mdoc', 'base', 'document.json'), `${JSON.stringify(content, null, 2)}\n`, 'utf8');
  await writeFile(config, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
  if (!existingInfo) await writeFile(join(root, 'theme.css'), '/* HCD theme overrides */\n', 'utf8');
}

export async function localStatus(rootPath = process.cwd()): Promise<{ info: SyncInfo; base: Document; status: LocalStatus; currentVersion?: number }> {
  const { root, info, base } = await loadSync(rootPath);
  const status = await compareLocalModules(root, info, base);
  let currentVersion: number | undefined;
  try { const credential = await credentialFor(info.server); currentVersion = (await api<{ currentVersion: number }>(credential, `/docs/${encodeURIComponent(info.documentId)}/head`)).currentVersion; }
  catch { /* Local status remains useful offline. */ }
  return { info, base, status, ...(currentVersion === undefined ? {} : { currentVersion }) };
}

export async function previewLocal(rootPath = process.cwd(), locale: 'zh-CN' | 'en' = 'zh-CN') {
  const { root, info, base } = await loadSync(rootPath);
  const status = await compareLocalModules(root, info, base);
  const credential = await credentialFor(info.server).catch(() => undefined);
  const { generateLocalPreview } = await import('./local-preview');
  const result = await generateLocalPreview({ root, document: { ...base, modules: status.modules }, baseVersion: info.baseVersion, credential, locale });
  return { ...result, warnings: status.warnings };
}

export async function cancelLocalReceipt(rootPath: string, key: string, credential: { server: string; token: string }) {
  const { root, info } = await loadSync(rootPath);
  if (normalizeServer(credential.server) !== info.server) throw new Error('Cancellation credential belongs to another server.');
  const actor: Credential = { ...credential, savedAt: '' };
  const identity = await api<{ user: { id: string } }>(actor, '/me');
  if (!/^u_[a-zA-Z0-9_-]{8,80}$/.test(identity.user?.id ?? '')) throw new Error('Server returned an invalid account identity.');
  return cancelWithReceipt({ root, key, server: info.server, documentId: info.documentId, actorId: identity.user.id,
    recover: (body, idempotencyKey) => api<CancellationResponse>(actor, `/docs/${encodeURIComponent(info.documentId)}/submissions`, { method: 'POST', body, idempotencyKey }),
    read: id => api<CancellationResponse>(actor, `/submissions/${encodeURIComponent(id)}`),
    withdraw: id => api<CancellationResponse>(actor, `/submissions/${encodeURIComponent(id)}/withdraw`, { method: 'POST', body: {} }),
  });
}

export async function submitLocal(rootPath = process.cwd(), message = '', yes = false, retry = false, suppliedCredential?: { server: string; token: string }): Promise<string> {
  const { root, info, base } = await loadSync(rootPath);
  const credential: Credential = suppliedCredential ? { ...suppliedCredential, server: normalizeServer(suppliedCredential.server), savedAt: '' } : await credentialFor(info.server);
  if (credential.server !== info.server) throw new Error('Submission credential belongs to another server.');
  const identity = await api<{ user: { id: string } }>(credential, '/me');
  if (!/^u_[a-zA-Z0-9_-]{8,80}$/.test(identity.user?.id ?? '')) throw new Error('Server returned an invalid account identity.');
  if (retry) {
    process.stdout.write('Retrying the exact saved request; newer local edits are not included.\n');
    if (!yes) {
      if (!process.stdin.isTTY) throw new Error('Pass --yes to confirm in a non-interactive terminal.');
      const { createInterface } = await import('node:readline/promises'); const readline = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await readline.question('Retry the saved submission? [y/N] '); readline.close(); if (!/^y(es)?$/i.test(answer.trim())) throw new Error('Submission cancelled.');
    }
    return submitWithReceipt({ root, server: info.server, documentId: info.documentId, actorId: identity.user.id, fingerprint: '0'.repeat(64), body: { baseVersion: info.baseVersion, content: base, message: '' }, retry: true,
      send: (body, idempotencyKey) => api<{ submission: { id: string; docId: string; authorId: string } }>(credential, `/docs/${encodeURIComponent(info.documentId)}/submissions`, { method: 'POST', idempotencyKey, body }),
    });
  }
  const sourceSnapshot = await readLocalSources(root);
  const fingerprint = requestFingerprint({ server: info.server, documentId: info.documentId, baseVersion: info.baseVersion, base, sourceSnapshot, message });
  const saved = (await inspectSubmissionReceipts(root)).receipts.find(receipt => receipt.fingerprint === fingerprint && receipt.server === info.server && receipt.documentId === info.documentId);
  // A saved request predates the current parser/operation format. Never regenerate it.
  if (saved) {
    if (saved.state === 'pending' && !yes) {
      if (!process.stdin.isTTY) throw new Error('Pass --yes to confirm in a non-interactive terminal.');
      const { createInterface } = await import('node:readline/promises'); const readline = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await readline.question('Retry the exact original saved request? [y/N] '); readline.close(); if (!/^y(es)?$/i.test(answer.trim())) throw new Error('Submission cancelled.');
    }
    return submitWithReceipt({ root, server: info.server, documentId: info.documentId, actorId: identity.user.id, fingerprint, existingOnly: true, body: { baseVersion: info.baseVersion, content: base, message },
      send: (body, idempotencyKey) => api<{ submission: { id: string; docId: string; authorId: string } }>(credential, `/docs/${encodeURIComponent(info.documentId)}/submissions`, { method: 'POST', idempotencyKey, body }),
    });
  }
  const plan = prepareSubmissionPlan({ base, sourceSnapshot, files: info.files });
  if (!plan.input) throw new Error(plan.submissionError ?? 'Local changes cannot be represented in one submission.');
  const status = plan.status;
  if (!status.added.length && !status.modified.length && !status.deleted.length && !status.moved.length) throw new Error('There are no local changes to submit.');
  process.stdout.write(`Will submit ${status.added.length} added, ${status.modified.length} modified, ${status.deleted.length} deleted and ${status.moved.length} moved module(s) against v${info.baseVersion}.\n`);
  if (status.warnings.length) process.stdout.write(`Local warnings (${status.warnings.length}):\n${status.warnings.map(terminalText).join('\n')}\n`);
  if (!yes && process.stdin.isTTY) {
    const { createInterface } = await import('node:readline/promises');
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await readline.question('Submit for owner review? [y/N] '); readline.close();
    if (!/^y(es)?$/i.test(answer.trim())) throw new Error('Submission cancelled.');
  } else if (!yes) throw new Error('Pass --yes to confirm in a non-interactive terminal.');
  return submitWithReceipt({ root, server: info.server, documentId: info.documentId, actorId: identity.user.id, fingerprint, body: { ...plan.input, baseVersion: info.baseVersion, message }, retry,
    send: (body, idempotencyKey) => api<{ submission: { id: string; docId: string; authorId: string } }>(credential, `/docs/${encodeURIComponent(info.documentId)}/submissions`, { method: 'POST', idempotencyKey, body }),
  });
}

function printHelp(): void {
  process.stdout.write(`mdoc — HCD command-line tools\n\nCommands:\n  login <server> [--no-open]         Approve CLI access in the browser (--token <PAT> also supported)\n  logout [server] [--local-only]     Revoke saved token(s) and remove local credentials\n  pull <document-id> [directory]     Pull module HTML files and a base snapshot\n  mcp [--server <origin>]            Forward MCP over stdio (saved token or HCD_TOKEN)\n  status                             Compare local files with the pulled snapshot\n  diff [--json | --ops]              Show readable changes, structured comparison or raw operations\n  submit -m <message> [--yes]        Submit local content for owner review (--retry resends saved request)\n  preview [--no-open]               Render the local working copy (--locale zh-CN|en)\n  receipts [--json]                 Inspect saved submission outcomes without document payloads\n  cancel <receipt-key> [--yes]       Recover the saved request, then withdraw its submission\n  import <file> --space <space-id>   Import HTML into a workspace\n  export <document-id> --out <file>  Queue HTML, PDF or ZIP (--version N); JSON also supported\n\nLogin requests browser approval with limited scopes. Personal tokens from HCD Settings are also supported.\n`);
}

function flag(args: string[], name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }

export async function downloadQueuedExport(credential: { server: string; token: string }, id: string, format: 'html' | 'pdf' | 'zip', output: string, version?: number) {
  const signal = AbortSignal.timeout(5 * 60000);
  type Job = { id: string; status: string; error?: string; downloadUrl?: string };
  async function request(path: string, body?: unknown) {
    const response = await fetch(`${credential.server}/api/v1${path}`, { method: body ? 'POST' : 'GET', redirect: 'error', signal, headers: { authorization: `Bearer ${credential.token}`, ...(body ? { 'content-type': 'application/json', 'x-hcd-request': '1' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json() as { export?: Job; error?: { code?: string } };
    if (!response.ok || !value.export) throw new Error(value.error?.code ?? `Export failed (${response.status}).`);
    return value.export;
  }
  let job = await request(`/docs/${encodeURIComponent(id)}/exports`, { format, version });
  while (['queued', 'running'].includes(job.status)) {
    await new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000); const abort = () => { clearTimeout(timeout); reject(signal.reason); }; if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); });
    job = await request(`/exports/${encodeURIComponent(job.id)}`);
  }
  if (job.status !== 'done' || !job.downloadUrl) throw new Error(job.error ?? 'Export failed.');
  const download = new URL(job.downloadUrl);
  if (!['https:', 'http:'].includes(download.protocol) || download.username || download.password) throw new Error('Invalid download URL.');
  // The render domain receives a short-lived signed URL, never the API token.
  const response = await fetch(download, { redirect: 'error', signal });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 80 * 1024 * 1024) { await reader.cancel(); throw new Error('Export exceeds download limit.'); } chunks.push(part.value); } } finally { reader.releaseLock(); }
  const target = resolve(output); const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  try { await writeFile(temporary, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 }); await rename(temporary, target); } finally { await rm(temporary, { force: true }); }
}

async function openBrowser(url: string) {
  const { execFile } = await import('node:child_process');
  const [program, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  await new Promise<void>((done, reject) => execFile(program as string, args as string[], { timeout: 10000 }, error => error ? reject(new Error('Could not open browser.')) : done()));
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help' || command === '-h') { printHelp(); return; }
  if (command === 'login') {
    const server = normalizeServer(rest[0] ?? '');
    const token = flag(rest, '--token') ?? process.env.HCD_TOKEN;
    // Validate existing metadata before starting an authorization that could replace it.
    await readCredentials();
    let credential: Credential;
    if (token !== undefined) {
      if (!PERSONAL_ACCESS_TOKEN_PATTERN.test(token)) throw new Error('Provide a valid personal access token with --token or HCD_TOKEN.');
      credential = { server, token, savedAt: new Date().toISOString() };
    } else {
      const controller = new AbortController(); const cancel = () => controller.abort();
      process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
      try {
        credential = await loginWithDevice({ server, hostname: hostname().slice(0, 100), signal: controller.signal, onRequest: async request => {
          process.stdout.write(`Open ${request.verifyUrl}\nConfirm that the page shows code ${request.code} and this computer. Waiting for your approval…\n`);
          if (!rest.includes('--no-open')) {
            try { await openBrowser(request.verifyUrl); }
            catch { process.stderr.write('Could not open the browser. Open the printed authorization URL manually.\n'); }
          }
        } });
      } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    }
    await api(credential, '/me');
    await saveCredential(credential);
    process.stdout.write(`Saved credentials for ${server}.\n`); return;
  }
  if (command === 'logout') {
    const credentials = await readCredentials();
    const serverArgument = rest.find(value => !value.startsWith('--')); const server = serverArgument ? normalizeServer(serverArgument) : undefined;
    const selected = credentials.servers.filter(item => !server || item.server === server); let failures = 0;
    for (const credential of selected) {
      try {
        if (!rest.includes('--local-only')) await revokeCredential(credential);
        await removeCredential(credential);
        process.stdout.write(`${rest.includes('--local-only') ? 'Removed locally' : 'Signed out'}: ${credential.server}\n`);
      } catch { failures++; process.stderr.write(`Could not revoke or remove credentials for ${credential.server}; retained for retry.\n`); }
    }
    if (failures) throw new Error('Some credentials could not be revoked. Retry logout when the server is reachable; --local-only removes local copies without revocation.');
    if (!selected.length) process.stdout.write('No matching saved credentials.\n');
    else if (rest.includes('--local-only')) process.stdout.write('Server tokens were not revoked. Revoke them in HCD Settings if needed.\n');
    return;
  }
  if (command === 'pull') {
    const id = rest[0]?.match(/d_[a-z2-7]{8}/)?.[0];
    if (!id) throw new Error('Usage: mdoc pull <document-id-or-link> [directory] [--force]');
    const target = rest.find((value, index) => index > 0 && !value.startsWith('--')) ?? '.';
    const credential = await credentialFor();
    await pullDocument(credential.server, credential.token, id, target, rest.includes('--force'));
    process.stdout.write(`Pulled ${id} into ${resolve(target)}.\n`); return;
  }
  if (command === 'status' || command === 'diff') {
    const { info, base, status, currentVersion } = await localStatus();
    if (!(command === 'diff' && (rest.includes('--json') || rest.includes('--ops')))) process.stdout.write(`Document ${info.documentId} · base v${info.baseVersion}${currentVersion ? ` · server v${currentVersion}` : ' · offline'}\n`);
    if (!(command === 'diff' && (rest.includes('--json') || rest.includes('--ops')))) for (const [kind, values] of [['added', status.added], ['modified', status.modified], ['deleted', status.deleted], ['moved', status.moved], ['renamed', status.renamed]] as const) for (const name of values) process.stdout.write(`${kind}: ${terminalText(name)}\n`);
    for (const warning of status.warnings) process.stderr.write(`Warning: ${terminalText(warning)}\n`);
    if (command === 'diff') {
      const target = { ...base, modules: status.modules };
      if (rest.includes('--ops')) process.stdout.write(`${JSON.stringify(diffDocuments(base, target, createCounterTmpIdSource('cli')), null, 2)}\n`);
      else { const changes = compareDocumentChanges(base, target); process.stdout.write(rest.includes('--json') ? `${JSON.stringify(changes, null, 2)}\n` : formatChanges(changes)); }
    }
    if (command === 'status' && ![...status.added, ...status.modified, ...status.deleted, ...status.moved, ...status.renamed].length) process.stdout.write('No local changes.\n');
    return;
  }
  if (command === 'submit') {
    const id = await submitLocal(process.cwd(), flag(rest, '-m') ?? flag(rest, '--message') ?? '', rest.includes('--yes'), rest.includes('--retry'));
    process.stdout.write(`Submitted ${id}. It is waiting for an owner review.\n`); return;
  }
  if (command === 'receipts') {
    const result = await inspectSubmissionReceipts(process.cwd());
    if (rest.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      for (const receipt of result.receipts) process.stdout.write(`${terminalText(receipt.key)} · ${receipt.state} · ${terminalText(receipt.server)} · ${receipt.documentId} · v${receipt.baseVersion}${receipt.submissionId ? ` · ${receipt.submissionId}` : ''}\n  ${terminalText(receipt.message)}\n`);
      if (!result.receipts.length) process.stdout.write('No current submission receipts.\n');
      if (result.legacyReceiptCount) process.stdout.write(`${result.legacyReceiptCount} legacy receipt(s) retained; these lack recoverable requests.\n`);
    }
    return;
  }
  if (command === 'cancel') {
    const key = rest[0]; if (!key || key.startsWith('-')) throw new Error('Usage: mdoc cancel <receipt-key> [--yes]. Use mdoc receipts to find the key.');
    const { info } = await loadSync(); const credential = await credentialFor(info.server);
    const receipt = (await inspectSubmissionReceipts(process.cwd())).receipts.find(item => item.key === key);
    if (!receipt) throw new Error('Submission receipt not found.');
    process.stdout.write('This recovers the exact saved request before withdrawing it. If its outcome is unknown, recovery may first create that submission. It cannot undo an already published version.\n');
    if (!rest.includes('--yes')) {
      if (!process.stdin.isTTY) throw new Error('Pass --yes to confirm in a non-interactive terminal.');
      const { createInterface } = await import('node:readline/promises'); const readline = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await readline.question('Recover and withdraw this saved request? [y/N] '); readline.close(); if (!/^y(es)?$/i.test(answer.trim())) throw new Error('Cancellation was not started.');
    }
    const result = await cancelLocalReceipt(process.cwd(), key, credential);
    if (result.status !== 'withdrawn') throw new Error(`Cannot withdraw ${result.submissionId}: server status is ${result.status}. The receipt has been preserved.`);
    process.stdout.write(`Withdrawn ${result.submissionId}. Its original request and key are retained; an identical request will not be sent again.\n`); return;
  }
  if (command === 'preview') {
    const locale = flag(rest, '--locale') ?? 'zh-CN';
    if (!['zh-CN', 'en'].includes(locale)) throw new Error('Preview locale must be zh-CN or en.');
    const result = await previewLocal(process.cwd(), locale as 'zh-CN' | 'en');
    process.stdout.write(`Local preview: ${terminalText(result.path)}\nDownloaded ${result.assetCount} unique asset(s).\n`);
    if (result.warnings.length) process.stdout.write(`Import warnings (${result.warnings.length}):\n${result.warnings.map(terminalText).join('\n')}\n`);
    if (!rest.includes('--no-open')) {
      try { await openBrowser(pathToFileURL(result.path).href); }
      catch { throw new Error('Preview was saved, but the browser could not be opened. Use --no-open to generate only.'); }
    }
    return;
  }
  if (command === 'import') {
    const file = rest.find((value) => !value.startsWith('-'));
    const spaceId = flag(rest, '--space');
    if (!file || !spaceId) throw new Error('Usage: mdoc import <file.html> --space <space-id> [--yes]');
    const credential = await credentialFor();
    const source = await readFile(resolve(file), 'utf8');
    const prepared = await api<{ import: { id: string; report: Record<string, unknown> } }>(credential, '/imports', { method: 'POST', body: { filename: basename(file), html: source, spaceId } });
    process.stdout.write(`Import report: ${JSON.stringify(prepared.import.report)}\n`);
    if (!rest.includes('--yes') && !process.stdin.isTTY) throw new Error(`Import prepared as ${prepared.import.id}; rerun interactively or pass --yes to confirm.`);
    if (!rest.includes('--yes')) {
      const { createInterface } = await import('node:readline/promises');
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await readline.question('Create a new document from this import? [y/N] '); readline.close();
      if (!/^y(es)?$/i.test(answer.trim())) { await api(credential, `/imports/${prepared.import.id}/discard`, { method: 'POST', body: {} }); return; }
    }
    const confirmed = await api<{ doc: { id: string; title: string } }>(credential, `/imports/${prepared.import.id}/confirm`, { method: 'POST', body: {} });
    process.stdout.write(`Imported ${confirmed.doc.title} as ${confirmed.doc.id}.\n`); return;
  }
  if (command === 'export') {
    const id = rest[0]?.match(/d_[a-z2-7]{8}/)?.[0]; const requestedOutput = flag(rest, '--out');
    const format = flag(rest, '--format') ?? (requestedOutput?.endsWith('.json') ? 'json' : 'html');
    const output = requestedOutput ?? `${id ?? 'document'}.${format}`; const selectedVersion = flag(rest, '--version'); const version = selectedVersion === undefined ? undefined : Number(selectedVersion);
    if (!id || !['html', 'json', 'pdf', 'zip'].includes(format) || (version !== undefined && (!Number.isInteger(version) || version < 1))) throw new Error('Usage: mdoc export <document-id> [--format html|pdf|zip|json] [--version N] [--out file]');
    const credential = await credentialFor();
    if (format === 'json') {
      const response = await fetch(`${credential.server}/api/v1/docs/${encodeURIComponent(id)}/export?format=json${version ? `&v=${version}` : ''}`, { headers: { authorization: `Bearer ${credential.token}` } });
      if (!response.ok) throw new Error(`Export failed (${response.status}).`);
      const body = await response.text(); await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(resolve(output), body, 'utf8');
    } else await downloadQueuedExport(credential, id, format as 'html' | 'pdf' | 'zip', output, version);
    process.stdout.write(`Exported ${id} to ${resolve(output)}.\n`); return;
  }
  if (command === 'mcp') {
    const server = flag(rest, '--server');
    const credential = server && process.env.HCD_TOKEN ? { server: normalizeServer(server), token: process.env.HCD_TOKEN } : await credentialFor(server);
    const { runMcpStdio } = await import('./mcp-relay'); await runMcpStdio(credential); return;
  }
  throw new Error(`Unknown command: ${command}. Run mdoc --help.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
