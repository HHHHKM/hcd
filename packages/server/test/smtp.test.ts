import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { configuredMailDelivery } from '../src/outbox';

describe('SMTP transport', () => {
  it('sends a notification only to the configured local SMTP fixture', async () => {
    const commands: string[] = []; let message = ''; const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.write('220 smtp.fixture.test ESMTP\r\n'); let buffer = ''; let data = false;
      socket.on('data', (chunk) => {
        buffer += chunk.toString(); let newline: number;
        while ((newline = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 2);
          if (data) { if (line === '.') { data = false; socket.write('250 accepted\r\n'); } else message += line.replace(/^\.\./, '.') + '\r\n'; continue; }
          commands.push(line);
          if (/^EHLO|^HELO/.test(line)) socket.write('250-smtp.fixture.test\r\n250 8BITMIME\r\n');
          else if (line === 'DATA') { data = true; socket.write('354 end with dot\r\n'); }
          else if (line === 'QUIT') socket.end('221 goodbye\r\n');
          else socket.write('250 OK\r\n');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture failed to listen');
    const delivery = configuredMailDelivery({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(address.port), SMTP_FROM: 'HCD <sender@fixture.test>', SMTP_REQUIRE_TLS: 'false' })!;
    try {
      await delivery.send({ to: 'reader@fixture.test', subject: 'HCD notification', text: 'Open your document', html: '<p>Open your document</p>', messageId: '<hcd-fixture@fixture.test>' });
      const test = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'packages/server/src/cli.ts', 'mail', 'test', '--to', 'cli@fixture.test', '--locale', 'en'], { env: { ...process.env, SMTP_HOST: '127.0.0.1', SMTP_PORT: String(address.port), SMTP_FROM: 'HCD <sender@fixture.test>', SMTP_REQUIRE_TLS: 'false', SMTP_USER: '', SMTP_PASS: '', SMTP_SECURE: 'false' } });
      expect(test.stdout).toContain('SMTP server accepted'); expect(commands).toContain('RCPT TO:<cli@fixture.test>'); expect(message).toContain('HCD email delivery test');
      expect(commands).toContain('MAIL FROM:<sender@fixture.test>'); expect(commands).toContain('RCPT TO:<reader@fixture.test>'); expect(message).toContain('Message-ID: <hcd-fixture@fixture.test>'); expect(message).toContain('Open your document');
    } finally { delivery.close?.(); for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it('requires both SMTP host and sender configuration', () => { expect(configuredMailDelivery({})).toBeUndefined(); expect(configuredMailDelivery({ SMTP_HOST: 'smtp.example.invalid' })).toBeUndefined(); });
});
