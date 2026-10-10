import { expect, type Page } from '@playwright/test';

/** Waits for the splash to go and the first screen to render. */
export async function open(page: Page, hash = '#/practice'): Promise<void> {
  await page.goto('/' + hash);
  await page.waitForSelector('.splash', { state: 'detached', timeout: 30_000 }).catch(() => {});
  await expect(page.locator('.app')).toBeVisible();
}

export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1000) < 900;

/** The live screen's current machine phase, from the data attribute the screen carries. */
export const livePhase = (page: Page) => page.locator('.live').getAttribute('data-state');

export async function waitForPhase(page: Page, phase: string | string[], timeout = 90_000): Promise<string> {
  const want = Array.isArray(phase) ? phase : [phase];
  const t0 = Date.now();
  for (;;) {
    const st = await livePhase(page).catch(() => null);
    if (st && want.includes(st)) return st;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for live phase ${want.join('|')} (now ${st})`);
    await page.waitForTimeout(200);
  }
}
