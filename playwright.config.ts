import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'es-ES',
    trace: 'off',
    video: 'off',
  },
  outputDir: 'reports/artifacts',
});
