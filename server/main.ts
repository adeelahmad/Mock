// Mock server — entry point. `npm run server` (or `node server/main.ts`).
//
//   PORT            listen port (8787)
//   HOST            listen address (0.0.0.0)
//   MOCK_DB         SQLite file (data/mock.db)
//   DATABASE_URL    postgres://… — use Postgres instead of SQLite
//   MOCK_STATIC     the built app to serve (dist; "" to serve the API only)
//   AUTH_SECRET     cookie/JWT secret (generated once and kept in the database if unset)
//   AUTH_URL        the public URL, when a proxy hides it (https://mock.example.com)
//   MOCK_SETUP_TOKEN  the first-run wizard's token (generated once and kept if unset)
//
// `node server/main.ts token` prints the setup token and exits.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openStore, type Store } from './store.ts';
import { Auth, authSecret, providerList } from './auth.ts';
import { createApp } from './app.ts';

async function setupToken(store: Store): Promise<string> {
  if (process.env.MOCK_SETUP_TOKEN) return process.env.MOCK_SETUP_TOKEN;
  const kept = await store.getConfig<string>('setup.token');
  if (kept) return kept;
  const t = randomBytes(18).toString('base64url');
  await store.setConfig('setup.token', t);
  return t;
}

const version = (): string => { try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch { return ''; } };

async function main(): Promise<void> {
  const store = await openStore();
  const token = await setupToken(store);
  if (process.argv[2] === 'token') { console.log(token); await store.close(); return; }

  const auth = new Auth(store, await authSecret(store));
  await auth.load();
  const staticDir = process.env.MOCK_STATIC ?? 'dist';
  const app = createApp({ store, auth, setupToken: token, staticDir: staticDir || null, version: version() });
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(port, host, () => {
    console.log('Mock server on http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + port + ' · ' + store.kind + (staticDir ? ' · serving ' + staticDir : ''));
    if (!providerList(auth.setup).length) console.log('Sign-in is not set up yet. Open the app; the setup wizard asks for this token:\n\n    ' + token + '\n');
  });
  const stop = () => { server.close(); void store.close().finally(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
