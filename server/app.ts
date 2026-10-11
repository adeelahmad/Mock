// Mock server — the HTTP surface. Small on purpose: the app stays local-first and works without
// it; with it, a signed-in user's library follows them to every browser.
//
//   GET  /api/status          server present? set up? which sign-in buttons? who is signed in?
//   POST /api/setup/verify    the first-run wizard checks the setup token
//   GET  /api/setup           the setup with secrets redacted (setup token or admin)
//   PUT  /api/setup           saves OAuth clients and the email allowlist (setup token or admin)
//   GET  /api/library         this user's synced library { rev, doc, updatedAt } (204 if none)
//   PUT  /api/library         { baseRev, doc } → { rev } or 409 { current } when another browser won
//   DELETE /api/library       forget the synced copy (the browsers keep theirs)
//   /auth/*                   Auth.js: sign-in, OAuth callbacks, sign-out, csrf, session
//   everything else           the built app (dist/), when present

import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import type { Store } from './store.ts';
import { Auth, BASE_PATH, providerList, type OAuthClient, type OidcClient, type Setup } from './auth.ts';

export interface AppOptions { store: Store; auth: Auth; setupToken: string; staticDir?: string | null; version?: string }

const LIBRARY_LIMIT = '50mb';

const sameToken = (a: unknown, b: string): boolean => {
  if (typeof a !== 'string' || !a || !b) return false;
  const x = Buffer.from(a.trim()), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const isDoc = (v: unknown): boolean => !!v && typeof v === 'object' && (v as { app?: unknown }).app === 'mock' && typeof (v as { tables?: unknown }).tables === 'object';

const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Merges a submitted client over the stored one: an empty secret keeps the stored secret. */
function client(next: unknown, prev: OAuthClient | undefined): OAuthClient | undefined {
  const n = (next ?? {}) as Record<string, unknown>;
  const clientId = str(n.clientId);
  if (!clientId) return undefined;
  const clientSecret = str(n.clientSecret, 2000) || (prev?.clientId === clientId ? prev.clientSecret : '');
  return { clientId, clientSecret };
}

export function redact(s: Setup | null): unknown {
  const r = (c?: OAuthClient) => (c ? { clientId: c.clientId, hasSecret: !!c.clientSecret } : null);
  const o = s?.providers.oidc;
  return {
    configured: !!s && providerList(s).length > 0,
    providers: { github: r(s?.providers.github), google: r(s?.providers.google), oidc: o ? { ...(r(o) as object), issuer: o.issuer, name: o.name ?? '' } : null },
    allowedEmails: s?.allowedEmails ?? [],
    hasAdmin: !!s?.adminUserId,
  };
}

export function createApp(o: AppOptions): express.Express {
  const { store, auth } = o;
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(BASE_PATH, auth.middleware());

  const api = express.Router();
  api.use(express.json({ limit: LIBRARY_LIMIT }));
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  api.get('/status', async (req, res) => {
    const user = await auth.user(req);
    const configured = providerList(auth.setup).length > 0;
    res.json({ server: true, version: o.version ?? '', db: store.kind, configured, providers: providerList(auth.setup), user });
  });

  // Setup is allowed with the setup token (printed in the server log) or as the admin.
  const canSetup = async (req: Request): Promise<boolean> => sameToken(req.get('x-setup-token'), o.setupToken) || !!(await auth.user(req))?.admin;

  api.post('/setup/verify', (req, res) => {
    if (sameToken(req.body?.token, o.setupToken)) res.json({ ok: true });
    else res.status(403).json({ error: 'bad_token', message: 'That is not the setup token. It is printed in the server log when the server starts.' });
  });

  api.get('/setup', async (req, res) => {
    if (!(await canSetup(req))) { res.status(403).json({ error: 'forbidden' }); return; }
    res.json(redact(auth.setup));
  });

  api.put('/setup', async (req, res) => {
    if (!(await canSetup(req))) { res.status(403).json({ error: 'forbidden' }); return; }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const p = (b.providers ?? {}) as Record<string, unknown>;
    const prev = auth.setup;
    const github = client(p.github, prev?.providers.github);
    const google = client(p.google, prev?.providers.google);
    const oc = client(p.oidc, prev?.providers.oidc);
    const oRaw = (p.oidc ?? {}) as Record<string, unknown>;
    const oidc: OidcClient | undefined = oc && str(oRaw.issuer) ? { ...oc, issuer: str(oRaw.issuer), name: str(oRaw.name, 60) || undefined } : undefined;
    const missing = [github, google, oidc].find((c) => c && !c.clientSecret);
    if (missing) { res.status(400).json({ error: 'secret_missing', message: 'Client ' + missing.clientId + ' needs its client secret' }); return; }
    if (!github && !google && !oidc) { res.status(400).json({ error: 'no_provider', message: 'Add at least one sign-in provider' }); return; }
    if (oidc && !/^https:\/\//i.test(oidc.issuer) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(oidc.issuer)) { res.status(400).json({ error: 'bad_issuer', message: 'The issuer must be an https URL' }); return; }
    const emails = (Array.isArray(b.allowedEmails) ? b.allowedEmails : String(b.allowedEmails ?? '').split(/[\s,;]+/))
      .map((e) => str(e, 320).toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+$/.test(e));
    const next: Setup = { providers: { github, google, oidc }, allowedEmails: [...new Set(emails)], adminUserId: prev?.adminUserId ?? null, configuredAt: new Date().toISOString() };
    await store.setConfig('setup', next);
    await auth.load();
    res.json(redact(auth.setup));
  });

  // ---- library sync
  const signedIn = async (req: Request, res: Response, next: NextFunction) => {
    const user = await auth.user(req);
    if (!user) { res.status(401).json({ error: 'signed_out' }); return; }
    res.locals.user = user;
    next();
  };

  api.get('/library', signedIn, async (_req, res) => {
    const row = await store.getLibrary(res.locals.user.id);
    if (!row) { res.status(204).end(); return; }
    res.json(row);
  });

  api.put('/library', signedIn, async (req, res) => {
    const { baseRev, doc } = (req.body ?? {}) as { baseRev?: unknown; doc?: unknown };
    if (typeof baseRev !== 'number' || !Number.isInteger(baseRev) || baseRev < 0 || !isDoc(doc)) { res.status(400).json({ error: 'bad_request', message: 'Expected { baseRev, doc }' }); return; }
    const r = await store.putLibrary(res.locals.user.id, baseRev, doc);
    if (r.ok) res.json({ rev: r.rev, updatedAt: r.updatedAt });
    else res.status(409).json({ error: 'conflict', current: r.current });
  });

  api.delete('/library', signedIn, async (_req, res) => {
    await store.deleteLibrary(res.locals.user.id);
    res.status(204).end();
  });

  api.use((_req, res) => { res.status(404).json({ error: 'not_found' }); });
  api.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.type ?? 'error', message: status >= 500 ? 'Server error' : err.message });
  });
  app.use('/api', api);

  if (o.staticDir && existsSync(o.staticDir)) {
    app.use(express.static(o.staticDir, {
      index: 'index.html',
      setHeaders: (res, path) => { if (/(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$/.test(path)) res.set('Cache-Control', 'no-cache'); },
    }));
  }
  return app;
}
