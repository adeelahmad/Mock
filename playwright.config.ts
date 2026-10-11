import { defineConfig, devices } from '@playwright/test';

// Flows run on the simulated transport (no API key, no network). The dev server is
// started by Playwright; set PW_BASE_URL to test a built/deployed site instead.
// The production build is served by the Go binary (bin/mock, app embedded) on :4173, with a fresh
// database and a fixed setup token, so the `pwa` project tests what ships: offline, sign-in setup.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: process.env.PW_BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'phone', testIgnore: /(offline|server)\.spec/, use: { ...devices['iPhone 14'], browserName: 'chromium', defaultBrowserType: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'desktop', testIgnore: /(offline|server)\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // The service worker only exists in a production build: built into bin/mock, served on :4173.
    { name: 'pwa', testMatch: /(offline|server)\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: process.env.PW_PWA_URL || 'http://localhost:4173' } },
  ],
  webServer: process.env.PW_BASE_URL ? undefined : [
    { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI, timeout: 60_000 },
    {
      command: 'make binary && rm -f bin/e2e.db* && MOCK_DB=bin/e2e.db MOCK_SETUP_TOKEN=e2e-setup-token ./bin/mock --port 4173',
      // Never reuse: a bin/mock left on :4173 from another checkout or an older build serves a
      // stale app and database, and the offline test then hangs on navigator.serviceWorker.ready.
      url: 'http://localhost:4173', reuseExistingServer: false, timeout: 300_000,
    },
  ],
});
