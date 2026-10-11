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
