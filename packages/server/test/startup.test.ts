import { expect, it } from 'vitest';
import { validateStartupEnvironment } from '../src/startup';

it('B11 rejects demo seeding in production before startup', () => {
  expect(() => validateStartupEnvironment({
    NODE_ENV: 'production', HCD_SEED_DEMO: '1', SECRET_KEY: 'x'.repeat(64), APP_URL: 'https://app.example', RENDER_URL: 'https://render.example',
  })).toThrow(/HCD_SEED_DEMO.*production|production.*HCD_SEED_DEMO/i);
});
