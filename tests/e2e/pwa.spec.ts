import { test, expect } from '@playwright/test';
import { open } from './helpers.ts';

// M5: manifest, shortcut deep links, the notices above Start.

test('manifest is linked, with icons and both shortcuts', async ({ page, request }) => {
  await open(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await request.get(new URL(href!, page.url()).toString());
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe('standalone');
  expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  expect(m.shortcuts.map((s: { url: string }) => s.url)).toEqual(['./#/start', './#/last']);
  for (const icon of [...m.icons, ...m.shortcuts.flatMap((s: { icons: unknown[] }) => s.icons)] as { src: string }[]) {
    expect((await request.get(new URL(icon.src, new URL(href!, page.url())).toString())).ok(), icon.src).toBe(true);
  }
});

test('#/last opens the latest session', async ({ page }) => {
  await open(page, '#/last');
  await expect(page).toHaveURL(/#\/history\/s14/);
  await expect(page.getByText(/Session 14/).first()).toBeVisible();
});

test('#/start starts today’s drill', async ({ page }) => {
  await open(page, '#/start');
  await expect(page).toHaveURL(/#\/live/);
  await expect(page.locator('.live')).toBeVisible();
});

test('backup nudge on Practice until dismissed', async ({ page }) => {
  await open(page);
  const nudge = page.getByText('Back up your last session');
  await expect(nudge).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(nudge).toBeHidden();
  await page.reload();
  await page.waitForSelector('.splash', { state: 'detached' }).catch(() => {});
  await expect(page.getByRole('button', { name: /^Start$/ })).toBeVisible();
  await expect(nudge).toBeHidden();
});

test('offline notice on Practice', async ({ page, context }) => {
  await open(page);
  await context.setOffline(true);
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
  await expect(page.getByText(/The demo runs offline/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Offline', { exact: true })).toBeHidden();
});
