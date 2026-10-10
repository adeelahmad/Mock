import { test, expect } from '@playwright/test';
import { open } from './helpers.ts';

test.describe('history and progress', () => {
  test('session list → detail → analysis cards', async ({ page }) => {
    await open(page, '#/history');
    await expect(page.getByText(/Session 14/).first()).toBeVisible();
    await page.getByRole('button', { name: /Session 14/ }).first().click();
    await expect(page).toHaveURL(/#\/history\/s14/);
    await expect(page.getByText(/Full loop/).first()).toBeVisible();
    await page.getByRole('tab', { name: /Analysis/ }).click().catch(() => {});
    await expect(page.getByText(/Numbers you missed/).first()).toBeVisible();
    await expect(page.getByText(/41 min to mitigate/).first()).toBeVisible();
    await expect(page.getByText(/Legacy data migration/).first()).toBeVisible();
  });

  test('progress shows the heatmap, weakest LPs and the trend', async ({ page }) => {
    await open(page, '#/progress');
    await expect(page.getByText(/Weakest LPs/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Drill$/ }).first()).toBeVisible();
    await expect(page.getByText(/Trend · average verdict/)).toBeVisible();
    await expect(page.getByText(/Story usage/)).toBeVisible();
    await expect(page.getByText('NOW')).toBeVisible();
  });
});

test.describe('settings', () => {
  test('theme switch applies dark; pause slider persists; backup downloads', async ({ page }) => {
    await open(page, '#/practice/settings');
    await page.getByRole('tab', { name: /^Dark$/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('tab', { name: /^Light$/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const slider = page.locator('input[type="range"]').first();
    await slider.fill('3000');
    await expect(page.getByText(/^3 s$/)).toBeVisible();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: /Back up everything|Export everything/ }).first().click();
    const d = await dl;
    expect(d.suggestedFilename()).toMatch(/mock.*\.json$/);
  });
});
