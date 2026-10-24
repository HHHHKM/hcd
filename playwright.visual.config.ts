import { defineConfig, devices } from '@playwright/test';

// Playwright explicitly sets FORCE_COLOR for its workers and web server. Remove
// the incompatible inherited opt-out before those child processes are spawned;
// this changes terminal colour handling only, and keeps all diagnostics visible.
delete process.env.NO_COLOR;

export default defineConfig({
  testDir: './visual',
  testMatch: '**/*.visual.ts',
  snapshotPathTemplate: 'outputs/visual-baseline/{arg}{ext}',
  timeout: 30_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  fullyParallel: false,
  // One worker: every scene shares the single disposable database started by visual-server.ts.
  workers: 1,
  outputDir: 'outputs/E3-complete-visual-artifacts',
  reporter: [['list'], ['json', { outputFile: 'outputs/E3-complete-visual-results.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:4173',
    locale: 'zh-CN',
    timezoneId: 'Asia/Taipei',
    colorScheme: 'light',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'tsx scripts/visual-server.ts',
    url: 'http://127.0.0.1:4173/healthz',
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
