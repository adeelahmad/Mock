import { test, expect } from '@playwright/test';
import { open } from './helpers.ts';

test.describe('library', () => {
  test('LPs → LP detail → Practise this LP starts a one-LP drill', async ({ page }) => {
    await open(page, '#/library/lps');
    await expect(page.getByRole('button', { name: /Dive Deep/ }).first()).toBeVisible();
    await page.getByRole('button', { name: /Dive Deep/ }).first().click();
    await expect(page).toHaveURL(/#\/library\/lps\/deep/);
    await expect(page.getByText(/Mapped stories/)).toBeVisible();
    await expect(page.getByText('Payments outage').first()).toBeVisible();
    await page.getByRole('button', { name: /Practise this LP/ }).click();
    await expect(page).toHaveURL(/#\/live$/);
    await expect(page.getByText(/One LP · Dive Deep|Dive Deep/).first()).toBeVisible();
  });

  test('stories → editor edits and saves; the grid cycles a mapping', async ({ page }) => {
    await open(page, '#/library/stories');
    await page.getByRole('button', { name: /Payments outage/ }).first().click();
    await expect(page).toHaveURL(/#\/library\/stories\/payments/);
    const learning = page.getByLabel(/Learning/).first();
    await learning.fill('Say the number first.');
    await page.getByRole('button', { name: /^Save$/ }).first().click();
    await open(page, '#/library/stories/payments');
    await expect(page.getByLabel(/Learning/).first()).toHaveValue('Say the number first.');

    await open(page, '#/library/stories/grid');
    await expect(page.getByText(/of 16 LPs covered/)).toBeVisible();
    const cell = page.getByRole('button', { name: /Launch under ambiguity × Think Big/ }).first();
    await cell.click(); // none → primary
    await open(page, '#/library/lps/big');
    await expect(page.getByText('Launch under ambiguity').first()).toBeVisible();
  });

  test('questions filter, model-answer sheet and add-question sheet', async ({ page }) => {
    await open(page, '#/library/questions');
    await expect(page.getByText(/questions ·/).first()).toBeVisible();
    await page.getByRole('button', { name: /Model answer/ }).first().click();
    await expect(page.getByText(/From your own stories/)).toBeVisible();
    await expect(page.getByText(/Situation/).first()).toBeVisible();
    await page.getByRole('button', { name: /^Close$/ }).first().click();
    await page.getByRole('button', { name: /^\+ (Add|Question)$/ }).first().click();
    await page.getByLabel(/^Question$/).fill('Tell me about a time you had to make a call between two of your own priorities.');
    await page.getByRole('button', { name: /Save to bank/ }).click();
    await expect(page.getByText(/make a call between two of your own priorities/).first()).toBeVisible();
  });

  test('files: include toggle and preview', async ({ page }) => {
    await open(page, '#/library/files');
    const sw = page.getByRole('switch').first();
    const before = await sw.getAttribute('aria-checked');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    await page.getByRole('button', { name: /loop-2024-notes\.md/ }).first().click();
    await expect(page).toHaveURL(/#\/library\/files\/f3/);
    await expect(page.getByText(/AWS loop — March 2024/)).toBeVisible();
  });
});
