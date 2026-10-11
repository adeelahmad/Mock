import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { encode } from '@auth/core/jwt';
import { openSqlite, type Store } from './store.ts';
import { Auth } from './auth.ts';
import { createApp } from './app.ts';

const SECRET = 'test-secret-test-secret-test-secret';
const TOKEN = 'setup-token-123';
const doc = (n: number) => ({ app: 'mock', version: 1, exportedAt: '2026-10-11T00:00:00Z', tables: { lps: [], stories: [{ id: 's' + n }], questions: [], files: [], sessions: [], exchanges: [], transcript: [], settings: {} } });

let store: Store, server: Server, base: string;
const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};
/** A session cookie as Auth.js would set it after an OAuth sign-in. */
const cookie = async (uid: string) => 'authjs.session-token=' + await encode({ token: { uid, name: 'Ada', email: 'ada@example.com', sub: uid }, secret: SECRET, salt: 'authjs.session-token' });

beforeEach(async () => {
  store = await openSqlite(':memory:');
  const auth = new Auth(store, SECRET);
  await auth.load();
  server = createApp({ store, auth, setupToken: TOKEN, staticDir: null }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
afterEach(async () => { server.close(); await store.close(); });

const setup = (body: unknown = { providers: { github: { clientId: 'gh-id', clientSecret: 'gh-secret' } }, allowedEmails: 'Ada@Example.com, bad' }) => req('PUT', '/api/setup', body, { 'x-setup-token': TOKEN });

describe('server setup', () => {
  it('starts unconfigured and needs the setup token', async () => {
    expect((await req('GET', '/api/status')).body).toMatchObject({ server: true, configured: false, providers: [], user: null, db: 'sqlite' });
    expect((await req('POST', '/api/setup/verify', { token: 'nope' })).status).toBe(403);
    expect((await req('POST', '/api/setup/verify', { token: TOKEN })).status).toBe(200);
    expect((await req('PUT', '/api/setup', { providers: { github: { clientId: 'x', clientSecret: 'y' } } })).status).toBe(403);
    expect((await req('GET', '/auth/providers')).status).toBe(503);
  });

  it('saves providers, redacts secrets, keeps a secret left empty, enables Auth.js', async () => {
    const r = await setup();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ configured: true, providers: { github: { clientId: 'gh-id', hasSecret: true }, google: null, oidc: null }, allowedEmails: ['ada@example.com'], hasAdmin: false });
    expect(JSON.stringify(r.body)).not.toContain('gh-secret');
    const again = await setup({ providers: { github: { clientId: 'gh-id', clientSecret: '' } }, allowedEmails: [] });
    expect(again.body.providers.github.hasSecret).toBe(true);
    expect((await store.getConfig<{ providers: { github: { clientSecret: string } } }>('setup'))!.providers.github.clientSecret).toBe('gh-secret');
    expect((await req('GET', '/api/status')).body.providers).toEqual([{ id: 'github', name: 'GitHub' }]);
    const p = await req('GET', '/auth/providers');
    expect(p.status).toBe(200);
    expect(p.body.github.callbackUrl).toMatch(/\/auth\/callback\/github$/);
  });

  it('rejects a setup with no provider or a new client without its secret', async () => {
    expect((await setup({ providers: {} })).status).toBe(400);
    expect((await setup({ providers: { google: { clientId: 'g' } } })).status).toBe(400);
    expect((await setup({ providers: { oidc: { clientId: 'o', clientSecret: 's', issuer: 'http://evil.example.com' } } })).status).toBe(400);
  });
});

describe('library sync API', () => {
  beforeEach(async () => { await setup(); });

  it('needs a signed-in user', async () => {
    expect((await req('GET', '/api/library')).status).toBe(401);
    expect((await req('PUT', '/api/library', { baseRev: 0, doc: doc(1) })).status).toBe(401);
  });

  it('knows the signed-in user from the Auth.js cookie', async () => {
    const s = await req('GET', '/api/status', undefined, { cookie: await cookie('github:42') });
    expect(s.body.user).toMatchObject({ id: 'github:42', email: 'ada@example.com', admin: false });
  });

  it('stores one library per user with compare-and-swap revisions', async () => {
    const a = { cookie: await cookie('github:1') }, b = { cookie: await cookie('github:2') };
    expect((await req('GET', '/api/library', undefined, a)).status).toBe(204);
    expect((await req('PUT', '/api/library', { baseRev: 0, doc: doc(1) }, a)).body.rev).toBe(1);
    expect((await req('PUT', '/api/library', { baseRev: 1, doc: doc(2) }, a)).body.rev).toBe(2);
    // A browser still on rev 1 loses and gets the current copy back.
    const lost = await req('PUT', '/api/library', { baseRev: 1, doc: doc(9) }, a);
    expect(lost.status).toBe(409);
    expect(lost.body.current).toMatchObject({ rev: 2, doc: doc(2) });
    expect((await req('GET', '/api/library', undefined, a)).body).toMatchObject({ rev: 2, doc: doc(2) });
    // Another user sees nothing of it.
    expect((await req('GET', '/api/library', undefined, b)).status).toBe(204);
    expect((await req('PUT', '/api/library', { baseRev: 0, doc: { not: 'mock' } }, b)).status).toBe(400);
    expect((await req('DELETE', '/api/library', undefined, a)).status).toBe(204);
    expect((await req('GET', '/api/library', undefined, a)).status).toBe(204);
  });

  it('rejects a forged cookie', async () => {
    const forged = 'authjs.session-token=' + await encode({ token: { uid: 'github:1' }, secret: 'another-secret-another-secret-xx', salt: 'authjs.session-token' });
    expect((await req('GET', '/api/library', undefined, { cookie: forged })).status).toBe(401);
  });
});
