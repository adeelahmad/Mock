import { test, expect, type Page } from '@playwright/test';
import { open } from './helpers.ts';

// The real storage: DuckDB-Wasm with IndexedDB snapshots, from an empty install.

const QUESTION = 'Tell me about a time you stored something and it survived a reload.';

/** The bank is long and pages by 40: filter to custom questions, where ours lives. */
async function expectQuestion(page: Page, text: string, present = true): Promise<void> {
  await page.getByLabel('Source', { exact: true }).selectOption('custom');
  const row = page.getByText(text, { exact: true });
  if (present) await expect(row.first()).toBeVisible(); else await expect(row).toHaveCount(0);
}

async function addQuestion(page: Page, text: string): Promise<void> {
  await open(page, '#/library/questions', 'duckdb');
  await page.getByRole('button', { name: /^\+ (Add|Question)$/ }).first().click();
  await page.getByLabel(/^Question$/).fill(text);
  await page.getByRole('button', { name: /Save to bank/ }).click();
  await expectQuestion(page, text);
}

test.describe('storage', () => {
  test.setTimeout(120_000);

  test('a fresh install has the LPs and the question bank, in DuckDB', async ({ page }) => {
    await open(page, '#/library/lps', 'duckdb');
    await expect(page.getByText('DuckDB-WASM ✓').first()).toBeVisible();
    await open(page, '#/library/questions', 'duckdb');
    await expect(page.getByText(/short-term sacrifices for long-term gains/).first()).toBeVisible();
  });

  test('writes survive a reload', async ({ page }) => {
    await addQuestion(page, QUESTION);
    await page.waitForTimeout(600); // the snapshot is debounced 250 ms
    await page.reload();
    await page.waitForSelector('.splash', { state: 'detached', timeout: 60_000 });
    await expectQuestion(page, QUESTION);
  });

  test('back up → delete everything → restore brings the library back', async ({ page }) => {
    await addQuestion(page, QUESTION);
    await open(page, '#/practice/settings', 'duckdb');
    await page.getByRole('button', { name: /Back up everything/ }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: /^Download$/ }).click();
    const file = await (await dl).path();
    await expect(page.locator('.sheet')).toHaveCount(0);
    page.on('dialog', (d) => void d.accept());
    await open(page, '#/practice/settings', 'duckdb');
    await page.getByRole('button', { name: /Delete all data/ }).click();
    await expect(page.getByText(/Everything on this device was deleted/)).toBeVisible();
    await open(page, '#/practice/settings', 'duckdb');
    await page.locator('#settings-restore').setInputFiles(file);
    await expect(page.getByText(/Inside/)).toBeVisible();
    await page.getByRole('button', { name: /Replace everything/ }).click();
    await expect(page.getByText(/^Restored .* · \d+ sessions? · \d+ questions?$/)).toBeVisible();
    await open(page, '#/library/questions', 'duckdb');
    await expectQuestion(page, QUESTION);
  });

  test('a passphrase backup asks for it on restore', async ({ page }) => {
    await open(page, '#/practice/settings', 'duckdb');
    await page.getByRole('button', { name: /Back up everything/ }).click();
    await page.locator('.sheet input[type="password"]').fill('open sesame');
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: /^Download$/ }).click();
    const d = await dl;
    expect(d.suggestedFilename()).toMatch(/\.mockbackup$/);
    await expect(page.locator('.sheet')).toHaveCount(0);
    await page.locator('#settings-restore').setInputFiles({ name: d.suggestedFilename(), mimeType: 'application/octet-stream', buffer: (await import('node:fs')).readFileSync((await d.path())!) });
    await page.locator('.sheet input[type="password"]').fill('wrong');
    await page.getByRole('button', { name: /^Unlock$/ }).click();
    await expect(page.getByText(/does not open this backup/)).toBeVisible();
    await page.locator('.sheet input[type="password"]').fill('open sesame');
    await page.getByRole('button', { name: /^Unlock$/ }).click();
    await expect(page.getByText(/Inside/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Merge$/ })).toBeVisible();
  });
});
