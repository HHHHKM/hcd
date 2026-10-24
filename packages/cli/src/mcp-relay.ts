import { Client, StreamableHTTPClientTransport, ProtocolError, type Transport } from '@modelcontextprotocol/client';
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

/** Every SDK request stays on the configured endpoint; redirects never carry credentials elsewhere. */
export function pinnedMcpFetch(endpoint: URL, token: string): typeof fetch {
  return async (input, init) => {
    const requested = new URL(input instanceof Request ? input.url : String(input));
    if (requested.href !== endpoint.href) throw new Error('MCP endpoint changed');
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.delete('cookie'); headers.set('authorization', `Bearer ${token}`);
    const signal = AbortSignal.any([AbortSignal.timeout(30000), ...(init?.signal ? [init.signal] : [])]);
    return fetch(endpoint, { ...init, headers, signal, redirect: 'error', credentials: 'omit' });
  };
}
export async function createMcpRelay(credential: { server: string; token: string }, transport: Transport) {
  const origin = new URL(credential.server);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !['http:', 'https:'].includes(origin.protocol) || origin.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Invalid HCD server origin');
  const endpoint = new URL('/mcp', origin);
  const remote = new Client({ name: 'mdoc', version: '0.1.0' }, { supportedProtocolVersions: ['2025-03-26'], enforceStrictCapabilities: true });
  const http = new StreamableHTTPClientTransport(endpoint, { fetch: pinnedMcpFetch(endpoint, credential.token), requestInit: { redirect: 'error' } });
  let local: Server | undefined; let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => { await Promise.allSettled([remote.close(), local?.close()]); })();
  try {
    await remote.connect(http, { timeout: 30000 });
    const capabilities = remote.getServerCapabilities();
    local = new Server({ name: 'hcd-mdoc', version: '0.1.0' }, {
      supportedProtocolVersions: ['2025-03-26'],
      capabilities: { ...(capabilities?.tools ? { tools: {} } : {}), ...(capabilities?.resources ? { resources: {} } : {}) },
      instructions: remote.getInstructions(),
    });
    // Keep protocol errors; replace network exception text so credentials/URLs cannot reach stdout.
    async function forward<T>(call: () => Promise<T>): Promise<T> {
      try { return await call(); }
      catch (error) { if (error instanceof ProtocolError) throw error; throw new ProtocolError(-32603, 'HCD upstream request failed'); }
    }
    if (capabilities?.tools) {
      local.setRequestHandler('tools/list', (request, ctx) => forward(() => remote.listTools(request.params, { signal: ctx.mcpReq.signal, timeout: 30000, cacheMode: 'bypass' })));
      local.setRequestHandler('tools/call', (request, ctx) => forward(() => remote.callTool(request.params, { signal: ctx.mcpReq.signal, timeout: 30000 })));
    }
    if (capabilities?.resources) {
      local.setRequestHandler('resources/list', (request, ctx) => forward(() => remote.listResources(request.params, { signal: ctx.mcpReq.signal, timeout: 30000, cacheMode: 'bypass' })));
      local.setRequestHandler('resources/read', (request, ctx) => forward(() => remote.readResource(request.params, { signal: ctx.mcpReq.signal, timeout: 30000, cacheMode: 'bypass' })));
    }
    await local.connect(transport); return { close, local, remote };
  } catch { await close(); throw new Error('Cannot connect to HCD MCP. Check the server address and token.'); }
}
export async function runMcpStdio(credential: { server: string; token: string }) {
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 5 * 1024 * 1024 });
  const relay = await createMcpRelay(credential, transport);
  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return; stopping = true;
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); process.stdin.removeListener('end', stop);
      void relay.close().finally(resolve);
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop); process.stdin.once('end', stop);
    const onclose = transport.onclose; transport.onclose = () => { onclose?.(); stop(); };
    if (process.stdin.readableEnded) stop();
  });
}
