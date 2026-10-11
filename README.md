# Mock

A personal voice app for rehearsing an AWS interview loop. A live interviewer (Gemini Live)
asks Leadership Principle questions and probes with follow-ups; between answers a coach says,
out loud, what to fix — judged against your own stories, numbers and notes. Every session is
recorded, every answer gets an analysis card, every session a report, and progress builds
across sessions.

Local-first: no backend, no account. Everything lives in your browser; backups move data
between phone and laptop. Your Gemini API key is stored on the device and sent only to Google.

Built to the Claude Design project in `design/` (the design is the spec). See `docs/plan.md`
for the architecture and milestones, `docs/design-inventory.md` for the feature checklist, and
`docs/STATUS.md` for where the work stands.

## Use it

1. Open the deployed site (or run it locally, below).
2. First run: drop your prep files (stories, question lists), paste a Gemini API key, say hello.
   Without a key everything runs on the built-in demo transport.
3. **Install it.** iPhone/iPad: Safari → Share → *Add to Home Screen* (this also stops Safari
   clearing the data of a site you haven't opened in a while). Android, desktop Chrome or Edge:
   the *Install* notice on Practice, or the install icon in the address bar.
4. Back up after sessions (Settings → Library & data). Practice reminds you when the last
   session isn't in a backup yet.

### What it costs

Every Gemini call reports how many tokens it used, and Mock adds them up. The **Spent** pill
always shows the total: top-right on phone, in the sidebar on desktop, and in the header during
a live session. Tap it for the split per Leadership Principle. Live tokens count toward the LP
of the question being asked, analysis cards toward the answer's LP, and session reports and
question tagging go under "Reports & other".

The price is set in **Settings → Budget**: one row per model, in USD per 1M tokens, with text
and audio input/output priced separately. It comes filled with Google's published prices
(checked 2026-10-11; Gemini 3.8 Flash doubles on 2027-01-01). Mock stores the token counts, not
dollars, so a new price re-prices everything already spent. Models without a row use the first
row. *Reset spend* sets the counter back to $0. The counts live in settings, so backups carry
them.

### Shortcuts and deep links

The installed app has two shortcuts (long-press the icon on Android, right-click on desktop):

| Link | Does |
|---|---|
| `…/#/start` | starts today's suggested drill |
| `…/#/last` | opens the latest session in History |

On iPhone, an iOS Shortcut ("Open URL" with either link) can go on the Action button or a
widget; a PWA can't add lock-screen widgets itself.

### Offline

Once loaded, the app shell, library, History and Progress work offline (service worker).
Live sessions need a connection: Practice says so and disables Start. The demo runs offline.

## Develop

With `make` (run `make help` for the list):

```
make install           # npm install, devDependencies included
make dev               # http://localhost:5173 (PORT=… to change)
make check             # typecheck + unit tests + build
make e2e               # Playwright (PW_CHROMIUM=/path/to/chromium for a local browser)
make verify            # check, then e2e
make preview           # build, then serve dist/
make clean             # remove dist/ and test results
```

Or the npm scripts directly:

```
npm install            # add --include=dev if NODE_ENV=production
npm run dev            # http://localhost:5173
npm run typecheck
npm test               # Vitest unit tests
npm run build          # static site in dist/
npm run preview        # serve dist/ locally
npm run e2e            # Playwright; set PW_CHROMIUM=/path/to/chromium to use a local browser
npm run refs           # design artboards → tests/design-refs (needs network)
npm run shots          # app screenshots → tests/screenshots (dev server running)
npm run icons          # re-render public/icons/*.png from the SVG sources
```

Dev-only: Settings → Library & data → *Load sample data*.

## Deploy

The build is a static site with relative asset paths and hash routing, so it runs from any
host or sub-path with no rewrite rules.

**GitHub Pages** (`.github/workflows/deploy.yml`, manual only):

1. Repo Settings → Pages → Source: **GitHub Actions** (once).
2. Actions → **Deploy to GitHub Pages** → Run workflow (branch or tag, default `main`). It
   type-checks, runs the unit tests, builds, and publishes `dist/` to
   `https://<user>.github.io/<repo>/`.

**Anywhere else:** `npm run build` and upload `dist/` (Netlify, Cloudflare Pages, S3, any web
server). Serve it over HTTPS: the microphone, service worker and install prompt require it.

**Proxmox VE** ([community-scripts](https://community-scripts.github.io/ProxmoxVE/) helper
script, using their engine): on the Proxmox host shell run

```
bash -c "$(curl -fsSL https://raw.githubusercontent.com/adeelahmad/Mock/main/proxmox/ct/mock.sh)"
```

While the repo is private, either clone it on the host and run `bash proxmox/ct/mock.sh`, or
`export MOCK_GITHUB_TOKEN=<read-only token>` and add
`-H "Authorization: Bearer $MOCK_GITHUB_TOKEN"` to the curl (the token is kept in the
container's git remote so `update` can pull).

You get the usual helper-script wizard (Default / Advanced, `var_*` overrides). It creates an
unprivileged Debian 13 container (2 vCPU, 2 GiB, 8 GB), installs Node 22 and Caddy, builds the
app and serves it on `https://<ip>/` (Caddy's internal CA: trust its root, printed at the end,
since the microphone needs trusted HTTPS) and `http://<ip>/`. Run `update` inside the container
to pull and rebuild when `main` moves.

## Stack

React 19 · TypeScript · Vite · DuckDB-Wasm on IndexedDB snapshots · Gemini Live and Flash ·
Workbox service worker · web app manifest with shortcuts. No backend.

## Layout

```
src/domain   types, state machine, readiness, parsers, selectors (pure, unit-tested)
src/live     transport interface, simulated + Gemini transports, session controller
src/db       Repo interface and implementations, backup
src/app      router, store, theme, prefs, install / offline / deep links
src/screens  one file per screen; src/components shared pieces
public       manifest, icons, the distilled Exponent question bank
design       the Claude Design export (the spec)
scripts      design refs, app screenshots, icon renderer
```
