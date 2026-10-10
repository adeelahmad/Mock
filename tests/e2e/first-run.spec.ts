import { test, expect } from '@playwright/test';
import { open } from './helpers.ts';

test.describe('first run', () => {
  test('walks drop → say hello → start and lands on Practice', async ({ page }) => {
    await open(page, '#/practice/setup');
    await expect(page.getByText('Your 16 LPs are ready.')).toBeVisible();
    await expect(page.getByText('CO', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Skip — start with the LPs/ }).click();
    await expect(page.getByText('Connect your interviewer.')).toBeVisible();
    await expect(page.getByText(/No key\? Skip/)).toBeVisible();
    await page.getByRole('button', { name: /^Next$/ }).click();
    await expect(page.getByText('That’s it.')).toBeVisible();
    await expect(page.getByText(/questions in the bank/)).toBeVisible();
    await page.getByRole('button', { name: /^Explore first$/ }).click();
    await expect(page).toHaveURL(/#\/practice$/);
    await expect(page.getByRole('button', { name: /^Start$/ })).toBeVisible();
  });

  test('Settings → Run first-run setup again opens the setup', async ({ page }) => {
    await open(page, '#/practice/settings');
    await page.getByRole('button', { name: /Run first-run setup again/ }).click();
    await expect(page).toHaveURL(/#\/practice\/setup/);
    await expect(page.getByText('Your 16 LPs are ready.')).toBeVisible();
  });
});
