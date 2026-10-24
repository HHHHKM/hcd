import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const launch = (command, args) => spawn(resolve(root, 'node_modules/.bin', command), args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' },
});
const server = launch('tsx', ['watch', 'packages/server/src/main.ts']);
const web = launch('vite', ['--host', '0.0.0.0']);
const cleanup = () => { server.kill('SIGTERM'); web.kill('SIGTERM'); };
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
server.on('exit', (code) => { web.kill('SIGTERM'); process.exitCode = code ?? 0; });
web.on('exit', (code) => { server.kill('SIGTERM'); process.exitCode = code ?? 0; });
