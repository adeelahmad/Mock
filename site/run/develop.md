# Develop

Needs Node 22.18 or newer, and Go 1.24 or newer for the server and the [binary](/run/go-binary). Clone the repo, then use `make` (or the npm scripts underneath).

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
| `make check` | typecheck + unit tests + build, then Go vet + tests |
| `make e2e` | Playwright; the production build runs from `bin/mock` (`PW_CHROMIUM=/path/to/chromium` for a local browser) |
| `make verify` | `check`, then `e2e` |
| `make build` | the static app in `dist/` |
| `make preview` | build, then serve `dist/` |
| `make server` | the Go server's API on :8787 (sign-in + sync); `make dev` proxies `/api` and `/auth` to it |
| `make serve` | build `bin/mock`, then serve the app and API from it |
| `make bridge` | only the [Meet bridge](/guide/meet) on 127.0.0.1:8788 |
| `make token` | print the sign-in setup token |
| `make binary` / `make binaries` | the [Go binary](/run/go-binary), for this machine / cross-compiled |
| `make docs` | this site, live on :5174 |
| `make docs-build` | build this site, with the app at `/app/`, into `site/.vitepress/dist` |
| `make clean` | remove build output, `bin/` and test results |

Other npm scripts: `npm run refs`
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
cmd/mock     the Go binary: serve, token, bridge
internal     Go: server (API + static), auth (OAuth/OIDC), store (SQLite/Postgres),
             meet (bridge, Chromium bot), web (the embedded app)
proxmox      the Proxmox VE helper script
site         this documentation site (VitePress)
design       the Claude Design export (the spec)
```

## Stack

React 19 · TypeScript · Vite · DuckDB-Wasm on IndexedDB · Gemini Live, Flash and embeddings ·
Workbox service worker · optional single Go binary: the app embedded, OAuth/OIDC sign-in,
SQLite or Postgres, and the Meet bridge (WebSocket, chromedp) · docs: VitePress.
