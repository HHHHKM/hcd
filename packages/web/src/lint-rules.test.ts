import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('AT-09 C1 enforces unsafe HTML and hook-order ESLint rules at the frontend source boundary', () => {
  const result = spawnSync(
    'pnpm',
    ['exec', 'eslint', '--stdin', '--stdin-filename', 'packages/web/src/UnsafeFixture.tsx', '--format', 'json'],
    {
      encoding: 'utf8',
      input: `import { useState } from 'react';
      export function Unsafe({ enabled }: { enabled: boolean }) {
        if (enabled) useState(false);
        document.body.innerHTML = '<p>unsafe</p>';
        return <div dangerouslySetInnerHTML={{ __html: 'unsafe' }} />;
      }`,
    },
  );
  expect(result.status).toBe(1);
  const messages = (JSON.parse(result.stdout) as Array<{ messages: Array<{ ruleId: string; message: string }> }>)[0]!
    .messages;
  expect(messages.filter((message) => message.ruleId === 'no-restricted-syntax')).toHaveLength(2);
  expect(messages.some((message) => message.ruleId === 'react-hooks/rules-of-hooks')).toBe(true);
});
