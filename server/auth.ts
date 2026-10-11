// Mock server — sign-in. Auth.js (@auth/express) with the OAuth clients the setup wizard stored:
// GitHub, Google and any OpenID Connect issuer. Sessions are JWT cookies (no adapter): the token
// carries the account id `<provider>:<account id>`, which keys the user's library.
//
// The config is rebuilt whenever setup changes, so a new client id takes effect without a restart.

import { ExpressAuth, getSession, type ExpressAuthConfig } from '@auth/express';
import GitHub from '@auth/express/providers/github';
import Google from '@auth/express/providers/google';
import type { Provider } from '@auth/express/providers';
import type { RequestHandler, Request } from 'express';
import { randomBytes } from 'node:crypto';
import type { Store } from './store.ts';

export interface OAuthClient { clientId: string; clientSecret: string }
export interface OidcClient extends OAuthClient { issuer: string; name?: string }
export interface Setup {
  providers: { github?: OAuthClient; google?: OAuthClient; oidc?: OidcClient };
  /** Lower-case emails allowed to sign in; empty = anyone with an account at a configured provider. */
  allowedEmails: string[];
  /** Who may change the setup after it is done: the first account to sign in. */
  adminUserId: string | null;
  configuredAt: string;
}

export interface SessionUser { id: string; name: string | null; email: string | null; image: string | null; admin: boolean }

export const BASE_PATH = '/auth';

export const providerList = (s: Setup | null): { id: string; name: string }[] => {
  if (!s) return [];
  const out: { id: string; name: string }[] = [];
  if (s.providers.github?.clientId) out.push({ id: 'github', name: 'GitHub' });
  if (s.providers.google?.clientId) out.push({ id: 'google', name: 'Google' });
  if (s.providers.oidc?.clientId && s.providers.oidc.issuer) out.push({ id: 'oidc', name: s.providers.oidc.name || 'Single sign-on' });
  return out;
};

function providers(s: Setup): Provider[] {
  const out: Provider[] = [];
  const { github, google, oidc } = s.providers;
  if (github?.clientId) out.push(GitHub({ clientId: github.clientId, clientSecret: github.clientSecret }));
  if (google?.clientId) out.push(Google({ clientId: google.clientId, clientSecret: google.clientSecret }));
  if (oidc?.clientId && oidc.issuer) out.push({ id: 'oidc', name: oidc.name || 'Single sign-on', type: 'oidc', issuer: oidc.issuer, clientId: oidc.clientId, clientSecret: oidc.clientSecret });
  return out;
}

/** The Auth.js secret: AUTH_SECRET, else one generated once and kept in the config table. */
export async function authSecret(store: Store, env = process.env): Promise<string> {
  if (env.AUTH_SECRET) return env.AUTH_SECRET;
  const kept = await store.getConfig<string>('auth.secret');
  if (kept) return kept;
  const s = randomBytes(32).toString('base64url');
  await store.setConfig('auth.secret', s);
  return s;
}

export class Auth {
  private config: ExpressAuthConfig | null = null;
  private handler: RequestHandler | null = null;
  private store: Store;
  private secret: string;
  setup: Setup | null = null;

  constructor(store: Store, secret: string) { this.store = store; this.secret = secret; }

  async load(): Promise<void> {
    this.setup = await this.store.getConfig<Setup>('setup');
    this.config = this.setup && providerList(this.setup).length ? this.build(this.setup) : null;
    this.handler = this.config ? ExpressAuth(this.config) : null;
  }

  private build(setup: Setup): ExpressAuthConfig {
    const store = this.store;
    return {
      basePath: BASE_PATH,
      secret: this.secret,
      trustHost: true,
      providers: providers(setup),
      session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 90 },
      callbacks: {
        signIn: ({ user, profile }) => {
          const allowed = this.setup?.allowedEmails ?? [];
          if (!allowed.length) return true;
          const email = (user.email ?? (profile?.email as string | undefined) ?? '').toLowerCase();
          return !!email && allowed.includes(email);
        },
        jwt: async ({ token, account, user }) => {
          if (account) {
            const id = account.provider + ':' + account.providerAccountId;
            await store.upsertUser({ id, provider: account.provider, email: user?.email ?? null, name: user?.name ?? null, image: user?.image ?? null });
            const setup = await store.getConfig<Setup>('setup');
            if (setup && !setup.adminUserId) {
              setup.adminUserId = id;
              await store.setConfig('setup', setup);
              this.setup = setup;
            }
            token.uid = id;
          }
          return token;
        },
        session: ({ session, token }) => {
          const s = session as unknown as { user: Record<string, unknown> };
          s.user = { ...s.user, id: token.uid };
          return session;
        },
      },
    };
  }

  /** Mounted at /auth: sign-in, callbacks, sign-out, csrf, session. */
  middleware(): RequestHandler {
    return (req, res, next) => {
      if (!this.handler) { res.status(503).json({ error: 'not_configured', message: 'Sign-in is not set up yet' }); return; }
      this.handler(req, res, next);
    };
  }

  async user(req: Request): Promise<SessionUser | null> {
    if (!this.config) return null;
    const s = await getSession(req, this.config).catch(() => null);
    const u = s?.user as { id?: string; name?: string; email?: string; image?: string } | undefined;
    if (!u?.id) return null;
    return { id: u.id, name: u.name ?? null, email: u.email ?? null, image: u.image ?? null, admin: this.setup?.adminUserId === u.id };
  }
}
