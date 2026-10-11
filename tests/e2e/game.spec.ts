import { test, expect, type Page } from '@playwright/test';
import { isPhone, open } from './helpers.ts';

// The Areas game: pick areas per question, check, reveal, next; a finished round is saved.
// Phone runs with touch (taps), desktop with the mouse.

async function press(page: Page, name: RegExp | string): Promise<void> {
  const b = page.getByRole('button', { name }).first();
  if (isPhone(page)) await b.tap(); else await b.click();
}

async function playRound(page: Page): Promise<void> {
  await press(page, /Start a round|Play again/);
  for (let i = 0; i < 20; i++) {
    const area = page.locator('.gm-area').first();
    if (isPhone(page)) await area.tap(); else await area.click();
    await expect(area).toHaveAttribute('aria-pressed', 'true');
    await press(page, /^Check$/);
    await expect(page.locator('.game')).toHaveAttribute('data-phase', 'revealed');
    await expect(page.locator('.gm-area.hit, .gm-area.wrong').first()).toBeVisible();
    const finish = page.getByRole('button', { name: /^Finish/ });
    if (await finish.count()) { await press(page, /^Finish/); break; }
    await press(page, /^Next/);
  }
  await expect(page.getByText('Round over')).toBeVisible();
}

test.describe('game', () => {
  test('play a round, see score, accuracy and history', async ({ page }) => {
    await open(page, '#/game');
    await expect(page.getByText(/Which area does each question test/)).toBeVisible();
    await playRound(page);
    await expect(page.getByText('Accuracy by area')).toBeVisible();
    await expect(page.getByText('Recent games')).toBeVisible();
    await expect(page.locator('.gm-tile-n').nth(1)).toHaveText('1');
  });

  test('gameplays survive a reload (DuckDB)', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, '#/game', 'duckdb');
    await playRound(page);
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForSelector('.splash', { state: 'detached', timeout: 60_000 });
    await expect(page.getByText('Recent games')).toBeVisible();
  });
});
