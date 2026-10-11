# Sign-in and sync

Mock is local-first: without an account, everything stays in this browser and backups move
data between devices. Run the small **Mock server** and sign in, and your library, sessions and
spend follow you to every browser you sign in on.

::: info Static hosting has no server
The hosted app on GitHub Pages has no server, so it stays local-only. Sync needs the
server: the [Go binary](/run/go-binary) (`make serve`) or [Proxmox](/run/proxmox).
:::

## Set it up

1. **First run.** Open the app; it finds an unconfigured server and opens the setup wizard.
   Paste the **setup token** from the server log (`mock token` or `make token`
   prints it again; on Proxmox, `mock-token`).
2. **Providers.** Add an OAuth client for GitHub, Google and/or any OpenID Connect issuer. The
   wizard shows the callback URL to register: `https://<host>/auth/callback/<provider>`.
   Secrets are stored on the server only and never sent back to the browser.
3. **Who can sign in.** An email allowlist (recommended on the internet). The first account to
   sign in becomes the admin and can change the setup from Settings → Account & sync.
4. **Sign in** on each browser. The first upload is this device's library; a fresh browser
   takes the server copy; a browser with its own library merges into it.

## How sync works

The library (stories, questions, files' text, sessions, transcripts, reports, settings, spend)
is one document per user with a revision. Writes push 1.5 s later; the app pulls on start, on
focus and every minute. When two browsers both changed, the merge keeps new items from both and
the newer edit of the same item.

Recordings, clips, uploaded originals and the Gemini key stay on each device.
"Use without an account" keeps Mock local-only.

## Server settings

| Variable | Default | |
|---|---|---|
| `PORT` / `HOST` | `8787` / every interface | listen address (`--port`, `--host`) |
| `MOCK_DB` | `data/mock.db` | SQLite file (pure Go, no native build) |
| `DATABASE_URL` | – | `postgres://…` to use Postgres instead |
| `MOCK_STATIC` | the embedded app | a directory to serve instead; `-` for API only |
| `AUTH_SECRET` | generated, kept in the DB | session cookie secret |
| `AUTH_URL` | from the request | public URL, if your proxy hides it |
| `MOCK_SETUP_TOKEN` | generated, kept in the DB | the wizard's token |
| `MOCK_MEET` | off | `1` = also run the [Meet bridge](/guide/meet) (`--meet`) |
| `MOCK_BRIDGE_PORT` | `8788` | the bridge's own port on 127.0.0.1 |
| `MOCK_BRIDGE_CODE` | random | a fixed pairing code |
| `MOCK_BRIDGE_ORIGINS` | dev, preview, GitHub Pages | app origins allowed to use the bridge |
| `MOCK_BRIDGE_CHROMIUM` | found on `PATH` | the Chrome/Chromium the Meet bot runs |

Run it behind HTTPS in production: the microphone and service worker need it.
