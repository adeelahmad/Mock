import { defineConfig, devices } from '@playwright/test';

// Flows run on the simulated transport (no API key, no network). The dev server is
// started by Playwright; set PW_BASE_URL to test a built/deployed site instead.
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
    { name: 'phone', testIgnore: /offline\.spec/, use: { ...devices['iPhone 14'], browserName: 'chromium', defaultBrowserType: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'desktop', testIgnore: /offline\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // The service worker only exists in a production build: built + previewed on :4173.
    { name: 'pwa', testMatch: /offline\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: process.env.PW_PWA_URL || 'http://localhost:4173' } },
  ],
  webServer: process.env.PW_BASE_URL ? undefined : [
    { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 180_000 },
  ],
});
