# Develop

Needs Node 22.18 or newer. Clone the repo, then use `make` (or the npm scripts underneath).

```sh
git clone https://github.com/adeelahmad/Mock && cd Mock
make install
make dev            # http://localhost:5173
```

## Makefile

`make help` lists the targets.

| Target | Does |
|---|---|
| `make install` | `npm install`, devDependencies included (even with `NODE_ENV=production`) |
| `make dev` | dev server on :5173 (`PORT=…` to change) |
| `make check` | typecheck + unit tests + build |
| `make e2e` | Playwright (`PW_CHROMIUM=/path/to/chromium` for a local browser) |
| `make verify` | `check`, then `e2e` |
| `make build` | the static app in `dist/` |
| `make preview` | build, then serve `dist/` |
| `make server` | the Mock server on :8787 (sign-in + sync); `make dev` proxies `/api` and `/auth` to it |
| `make start` | build, then serve the app and API from the Mock server |
| `make token` | print the sign-in setup token |
| `make docs` | this site, live on :5174 |
| `make docs-build` | build this site, with the app at `/app/`, into `site/.vitepress/dist` |
| `make clean` | remove build output and test results |

Other npm scripts: `npm run meet-bridge` (the [Meet bridge](/guide/meet)), `npm run refs`
(design artboards), `npm run shots` (app screenshots), `npm run icons` (re-render icons).

Dev-only: Settings → Library & data → *Load sample data*. URL switches for tests:
`?repo=sample` (in-memory sample library) and `?repo=memory` (in-memory, empty).

## Layout

```
src/domain   types, state machine, readiness, parsers, selectors (pure, unit-tested)
src/live     transports (simulated + Gemini Live), session controller, context tools
src/rag      chunking, embeddings, the knowledge index behind hints
src/meet     Google Meet: bridge client, Meet audio, sign-in and meeting creation
src/db       Repo interface, DuckDB-Wasm + IndexedDB storage, backup
src/sync     sync engine and the server API client
src/screens  one file per screen; src/components shared pieces
server       the Mock server: Auth.js sign-in, setup, sync API, SQLite/Postgres
meet-bridge  the local Meet bridge: WebSocket server, Playwright bot
proxmox      the Proxmox VE helper script
site         this documentation site (VitePress)
design       the Claude Design export (the spec)
```

## Stack

React 19 · TypeScript · Vite · DuckDB-Wasm on IndexedDB · Gemini Live, Flash and embeddings ·
Workbox service worker · optional server: Express, Auth.js, SQLite or Postgres · optional Meet
bridge: Node, Playwright, ws · docs: VitePress.
