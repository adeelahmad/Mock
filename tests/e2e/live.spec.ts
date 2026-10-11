import { test, expect } from '@playwright/test';
import { isPhone, open, waitForPhase } from './helpers.ts';

test.describe('live session on the simulated transport', () => {
  test.setTimeout(240_000);

  test('Start on the home screen plays a drill through to the recap, then History has the session', async ({ page }) => {
    await open(page);
    await expect(page.getByText(/Session 15 · chosen for you/)).toBeVisible();
    await page.getByRole('button', { name: /^Start$/ }).click();
    await expect(page).toHaveURL(/#\/live$/);
    await expect(page.locator('.live')).toBeVisible();
    // Demo banner (no Gemini key) and the connecting state
    await expect(page.getByText(/Demo · add a Gemini key/)).toBeVisible();
    await waitForPhase(page, ['connecting', 'interviewer'], 20_000);
    // The first question is pinned once new_question arrives
    await expect(page.getByText(/found a problem that others had missed/).first()).toBeVisible({ timeout: 40_000 });
    await waitForPhase(page, 'answering', 60_000);
    await expect(page.getByText(/Your answer|Still listening/)).toBeVisible();
    // Coaching: accent flips, strength + fixes + verdict arrive
    await waitForPhase(page, 'coaching', 90_000);
    await expect(page.getByText('Strength', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Open with the numbers/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Not inclined/i).first()).toBeVisible({ timeout: 20_000 });
    // End → recap
    await page.getByRole('button', { name: /^End/ }).first().click();
    await waitForPhase(page, ['ended', 'end'], 20_000);
    await expect(page.getByText(/complete\./)).toBeVisible();
    await expect(page.getByText(/fixes to drill/)).toBeVisible();
    await page.getByRole('button', { name: /Review in History/ }).click();
    await expect(page).toHaveURL(/#\/history\/s_/);
    await expect(page.getByText(/Session 15/).first()).toBeVisible();
    // the analysis tab holds the card for the coached answer
    if (isPhone(page)) await page.getByRole('tab', { name: /Analysis/ }).click();
    await expect(page.getByText(/You named the exact failing component/).first()).toBeVisible({ timeout: 10_000 });
  });

  test('pause holds the timer and resume continues; hint shows the story; keyboard works on desktop', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: /^Start$/ }).click();
    await waitForPhase(page, 'answering', 90_000);
    await page.getByRole('button', { name: /^Pause$/ }).click();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    await expect(page.getByText(/Mic off · timer held/)).toBeVisible();
    await page.getByRole('button', { name: /^Resume$/ }).click();
    await expect(page.getByText('Paused', { exact: true })).toBeHidden();
    if (isPhone(page)) await page.getByRole('button', { name: /^Hint$/ }).click();
    else await page.keyboard.press('h');
    await expect(page.getByText(/Try the Payments outage story/)).toBeVisible();
    await page.getByRole('button', { name: /Dismiss hint/ }).click();
    await expect(page.getByText(/Try the Payments outage story/)).toBeHidden();
    await page.getByRole('button', { name: /^End/ }).first().click();
    await waitForPhase(page, ['ended', 'end'], 20_000);
  });
});
