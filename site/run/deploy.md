# Deploy

The app builds to a static site with relative asset paths and hash routing, so it runs from
any host or sub-path with no rewrite rules. Serve it over HTTPS: the microphone, service worker
and install prompt require it.

## GitHub Pages

`.github/workflows/pages.yml` publishes this site at the Pages root and the app at `/app/`:

```
https://<user>.github.io/<repo>/       this site
https://<user>.github.io/<repo>/app/   the app
```

It runs on every push to `main` and from Actions → **Pages** → *Run workflow*. Each run
type-checks, runs the unit tests, builds the app and the site, and deploys both together.

**One-time setup:** repo Settings → Pages → *Build and deployment* → Source: **GitHub
Actions**. Pages on a private repository needs a paid GitHub plan (Pro, Team or Enterprise).

The site's base path defaults to `/Mock/`. For a fork with another name, or a custom domain,
set `DOCS_BASE` in the workflow (`/` for a custom domain). The app needs no change.

Pages has no server, so the hosted app stays local-only; see [sign-in and sync](/guide/sync).

## Anywhere else

From a checkout (needs Node, see [Build from source](/run/develop)):

```sh
make build      # or npm run build
```

Upload `dist/` to Netlify, Cloudflare Pages, S3 or any web server.

## With the server

[Install the binary](/run/install) and run `mock`: it serves the app with the sign-in and sync
API from that one file on :8787 (from a checkout, `make serve` builds and runs it). Put it behind a reverse proxy with HTTPS. See
[Proxmox](/run/proxmox) for a ready container.
