import { test, expect } from '@playwright/test';
import { open } from './helpers.ts';

// The real Mock server: the Go binary (bin/mock) serving the embedded production build on :4173,
// started by Playwright with a fresh database and MOCK_SETUP_TOKEN=e2e-setup-token. No stubs:
// the wizard talks to the Go API, and "Sign in with GitHub" goes through its OAuth redirect.

test('the Go binary serves the app, runs the setup wizard and starts a GitHub sign-in', async ({ page, request }) => {
  test.setTimeout(120_000);
  const before = await (await request.get('/api/status')).json();
  expect(before).toMatchObject({ server: true, db: 'sqlite' });
  test.skip(before.configured, 'this server was set up by an earlier run (reused server); restart it for a fresh database');

  await open(page, '#/practice');
  await expect(page.getByText('Set up sign-in.')).toBeVisible();
  await page.getByLabel('Setup token').fill('wrong');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/That is not the setup token/)).toBeVisible();
  await page.getByLabel('Setup token').fill('e2e-setup-token');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Sign-in providers.')).toBeVisible();
  await expect(page.getByText(/localhost:4173\/auth\/callback\/github$/)).toBeVisible();
  await page.getByLabel('Client ID').fill('gh-e2e-id');
  await page.getByLabel('Client secret').fill('gh-e2e-secret');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Allowed emails').fill('ada@example.com');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();

  const after = await (await request.get('/api/status')).json();
  expect(after).toMatchObject({ configured: true, providers: [{ id: 'github', name: 'GitHub' }], user: null });
  const setup = await (await request.get('/api/setup', { headers: { 'x-setup-token': 'e2e-setup-token' } })).json();
  expect(setup).toMatchObject({ providers: { github: { clientId: 'gh-e2e-id', hasSecret: true } }, allowedEmails: ['ada@example.com'] });
  expect(JSON.stringify(setup)).not.toContain('gh-e2e-secret');

  // Sign-in posts the CSRF token to the server, which redirects to GitHub with PKCE.
  const { csrfToken } = await (await request.get('/auth/csrf')).json();
  const signin = await request.post('/auth/signin/github', { form: { csrfToken, callbackUrl: 'http://localhost:4173/#/practice' }, maxRedirects: 0 });
  expect(signin.status()).toBe(302);
  const authorize = new URL(signin.headers()['location']);
  expect(authorize.origin + authorize.pathname).toBe('https://github.com/login/oauth/authorize');
  expect(authorize.searchParams.get('client_id')).toBe('gh-e2e-id');
  expect(authorize.searchParams.get('redirect_uri')).toBe('http://localhost:4173/auth/callback/github');
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  // A forged form is turned away.
  const forged = await request.post('/auth/signin/github', { form: { csrfToken: 'forged' }, maxRedirects: 0 });
  expect(forged.headers()['location']).toMatch(/\/auth\/error\?error=MissingCSRF$/);

  // Without a session the library API stays closed.
  expect((await request.get('/api/library')).status()).toBe(401);
});
