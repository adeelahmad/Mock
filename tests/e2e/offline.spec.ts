import { test, expect } from '@playwright/test';

// The production build: the service worker precaches the app, fonts, the question bank and
// DuckDB, so a second visit opens offline with the library intact.

test('opens offline after the first visit, with the library in DuckDB', async ({ page, context }) => {
  test.setTimeout(180_000);
  // Served by the Mock server (bin/mock), which offers sign-in: use Mock on this device only.
  await page.addInitScript(() => localStorage.setItem('mock.account.skip', '1'));
  await page.goto('./#/library/lps');
  await page.waitForSelector('.splash', { state: 'detached', timeout: 90_000 });
  await expect(page.getByText('DuckDB-WASM ✓').first()).toBeVisible();
  // Wait until the service worker controls the page and has finished precaching.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });
  await page.waitForSelector('.splash', { state: 'detached', timeout: 90_000 });
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.splash', { state: 'detached', timeout: 90_000 });
  await expect(page.getByText('DuckDB-WASM ✓').first()).toBeVisible();
  await page.goto('./#/library/questions');
  await expect(page.getByText(/short-term sacrifices for long-term gains/).first()).toBeVisible();
  const font = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "DM Sans Variable"'); });
  expect(font).toBe(true);
});
