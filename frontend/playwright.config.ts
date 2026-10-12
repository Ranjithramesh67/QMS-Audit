import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for the QMS Audit Platform.
 *
 * The app is served through the Vite dev server on port 5173, which proxies
 * /api to the Express backend on 3001. Tests therefore talk to a single origin.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 2,
  reporter: [['list']],
  outputDir: './e2e/.artifacts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bash /workspace/start.sh',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
