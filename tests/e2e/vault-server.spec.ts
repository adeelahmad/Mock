import { test, expect, type Browser, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Passphrase sync end to end, in real browsers: two separate browser profiles (contexts) turn on
// sync with the same passphrase and trade the library over a WebRTC data channel; a third joins
// with a pairing code instead of the passphrase. The relay is the Go binary's /signal, started
// here as an open relay (MOCK_SIGNAL=open) so no OAuth provider is needed; it also serves the app.

const BIN = new URL('../../bin/mock', import.meta.url).pathname;
const PASS = 'violet anchor harbor tulip comet walnut prism ember';

async function startServer(): Promise<{ base: string; close: () => Promise<void> }> {
  if (!fs.existsSync(BIN)) throw new Error('bin/mock is missing: run `make binary` first');
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mock-vault-')), 'e2e.db');
  const p = spawn(BIN, ['--port', '0'], { env: { ...process.env, MOCK_DB: db, MOCK_SIGNAL: 'open', MOCK_SETUP_TOKEN: 'vault-e2e' } });
  let out = '';
  const port = await new Promise<number>((resolve, reject) => {
    const onData = (b: Buffer) => { out += b.toString(); const m = /Mock server on http:\/\/[^:]+:(\d+)/.exec(out); if (m) resolve(Number(m[1])); };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.once('exit', (c) => reject(new Error('server exited ' + c + ': ' + out)));
    setTimeout(() => reject(new Error('server did not start: ' + out)), 15_000);
  });
  return { base: 'http://localhost:' + port, close: () => new Promise<void>((r) => { p.once('exit', () => r()); p.kill('SIGTERM'); }) };
}

async function device(browser: Browser, base: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: base });
  // Use the app without signing in to this server (the relay is open).
  await ctx.addInitScript(() => { try { localStorage.setItem('mock.account.skip', '1'); } catch { /* blocked */ } });
  const page = await ctx.newPage();
  await page.goto('/?repo=sample#/practice/settings');
  await page.waitForSelector('.splash', { state: 'detached', timeout: 30_000 }).catch(() => {});
  await expect(page.getByText('Sync with a passphrase')).toBeVisible();
  return page;
}

async function turnOn(page: Page): Promise<void> {
  await page.getByText('Sync with a passphrase').click();
  await page.getByRole('textbox', { name: /^Passphrase/ }).fill(PASS);
  await expect(page.getByText(/Strong enough/)).toBeVisible();
  await page.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(page.getByTestId('vault-status')).toBeVisible({ timeout: 30_000 });
}

async function addStory(page: Page, title: string): Promise<void> {
  await page.evaluate(() => { location.hash = '#/library/stories'; });
  await page.getByRole('button', { name: '+ Story' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create story' }).click();
}

const stories = (page: Page) => page.evaluate(() => { location.hash = '#/library/stories'; });

test('two browsers with the same passphrase sync directly; a third pairs with a code', async ({ browser }) => {
  test.setTimeout(150_000);
  const server = await startServer();
  try {
    const a = await device(browser, server.base);
    const b = await device(browser, server.base);
    await turnOn(a);
    await turnOn(b);
    await expect(a.getByTestId('vault-status')).toContainText('Live with 1 other device', { timeout: 30_000 });
    await expect(b.getByTestId('vault-status')).toContainText('Live with 1 other device');

    // A writes; B sees it without reloading.
    await addStory(a, 'Synced from browser A');
    await stories(b);
    await expect(b.getByText('Synced from browser A')).toBeVisible({ timeout: 15_000 });
    // B writes back.
    await addStory(b, 'And back from browser B');
    await stories(a);
    await expect(a.getByText('And back from browser B')).toBeVisible({ timeout: 15_000 });

    // A third browser never sees the passphrase: A shows a code, C types it.
    await a.evaluate(() => { location.hash = '#/practice/settings'; });
    await a.getByRole('button', { name: /Pair a device/ }).click();
    const code = (await a.getByTestId('pair-code').textContent())!.trim();
    expect(code).toMatch(/^\d{1,3}-[a-z]+-[a-z]+$/);
    await expect(a.locator('.vault-qr svg')).toBeVisible();
    const c = await device(browser, server.base);
    await c.getByText('Sync with a passphrase').click();
    await c.getByRole('tab', { name: 'Pair with a code' }).click();
    await c.getByRole('textbox', { name: /^Code from your other device/ }).fill(code);
    await c.getByRole('button', { name: 'Pair', exact: true }).click();
    await expect(c.getByTestId('vault-status')).toBeVisible({ timeout: 30_000 });
    await stories(c);
    await expect(c.getByText('Synced from browser A')).toBeVisible({ timeout: 30_000 });
    await expect(c.getByText('And back from browser B')).toBeVisible();
  } finally {
    await server.close();
  }
});

test('the pairing link opens the join sheet with the code filled in', async ({ browser }) => {
  const server = await startServer();
  try {
    const ctx = await browser.newContext({ baseURL: server.base });
    await ctx.addInitScript(() => { try { localStorage.setItem('mock.account.skip', '1'); } catch { /* blocked */ } });
    const page = await ctx.newPage();
    await page.goto('/?repo=sample#/practice/settings?pair=42-violet-anchor');
    await expect(page.getByRole('textbox', { name: /^Code from your other device/ })).toHaveValue('42-violet-anchor', { timeout: 30_000 });
  } finally {
    await server.close();
  }
});
