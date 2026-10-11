import { test, expect, type Page } from '@playwright/test';
import { open } from './helpers.ts';

// The Mock server's API is stubbed here (server/app.test.ts covers the real one): these flows
// check the wizard, the sign-in gate and Settings → Account & sync.

interface Fake { configured: boolean; user: null | { id: string; name: string; email: string; image: null; admin: boolean }; saved: unknown[] }

async function fakeServer(page: Page, f: Fake): Promise<void> {
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const providers = () => (f.configured ? [{ id: 'github', name: 'GitHub' }] : []);
  await page.route('**/api/status', (r) => r.fulfill(json({ server: true, version: '0.1.0', db: 'sqlite', configured: f.configured, providers: providers(), user: f.user })));
  await page.route('**/api/setup/verify', (r) => r.fulfill(r.request().postDataJSON().token === 'tok' ? json({ ok: true }) : json({ error: 'bad_token', message: 'bad' }, 403)));
  await page.route('**/api/setup', (r) => {
    if (r.request().method() === 'PUT') { f.saved.push(r.request().postDataJSON()); f.configured = true; }
    return r.fulfill(json({ configured: f.configured, providers: { github: f.configured ? { clientId: 'gh-id', hasSecret: true } : null, google: null, oidc: null }, allowedEmails: f.configured ? ['ada@example.com'] : [], hasAdmin: false }));
  });
  await page.route('**/api/library', (r) => r.fulfill(r.request().method() === 'GET' ? { status: 204, body: '' } : json({ rev: 1, updatedAt: new Date().toISOString() })));
}

test.describe('account & sync', () => {
  test('a fresh server opens the setup wizard: token → providers → emails → sign in', async ({ page }) => {
    const f: Fake = { configured: false, user: null, saved: [] };
    await fakeServer(page, f);
    await open(page, '#/practice');
    await expect(page.getByText('Set up sign-in.')).toBeVisible();
    await page.getByLabel('Setup token').fill('wrong');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/That is not the setup token/)).toBeVisible();
    await page.getByLabel('Setup token').fill('tok');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Sign-in providers.')).toBeVisible();
    await expect(page.getByText(/\/auth\/callback\/github$/)).toBeVisible();
    await page.getByLabel('Client ID').fill('gh-id');
    await page.getByLabel('Client secret').fill('gh-secret');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Allowed emails').fill('ada@example.com');
    await page.getByRole('button', { name: 'Save' }).click();
    // Saved: the server is set up, so the gate moves on to sign-in.
    await expect(page.getByText(/Ready\. Sign in\.|Sign in to sync\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();
    expect(f.saved[0]).toEqual({ providers: { github: { clientId: 'gh-id', clientSecret: 'gh-secret' } }, allowedEmails: ['ada@example.com'] });
  });

  test('a set-up server asks to sign in; "Use without an account" is remembered', async ({ page }) => {
    await fakeServer(page, { configured: true, user: null, saved: [] });
    await open(page, '#/practice');
    await expect(page.getByText('Sign in to sync.')).toBeVisible();
    await page.getByRole('button', { name: 'Use without an account' }).click();
    await expect(page.getByRole('button', { name: /^Start$/ })).toBeVisible();
    await page.reload();
    await page.waitForSelector('.splash', { state: 'detached' });
    await expect(page.getByText('Sign in to sync.')).toHaveCount(0);
    await open(page, '#/practice/settings');
    await expect(page.getByText('Account & sync')).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign in with GitHub/ })).toBeVisible();
  });

  test('signed in: Settings shows the account and the sync state', async ({ page }) => {
    await fakeServer(page, { configured: true, user: { id: 'github:1', name: 'Ada', email: 'ada@example.com', image: null, admin: true }, saved: [] });
    await open(page, '#/practice/settings');
    await expect(page.getByText('Ada', { exact: true })).toBeVisible();
    await expect(page.getByText(/Synced just now|Not synced yet|Changes waiting/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign-in setup/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign out/ })).toBeVisible();
  });

  test('a static host with no server shows no account UI', async ({ page }) => {
    await page.route('**/api/status', (r) => r.fulfill({ status: 404, body: 'not found' }));
    await open(page, '#/practice/settings');
    await expect(page.getByText('Account & sync')).toHaveCount(0);
  });
});
