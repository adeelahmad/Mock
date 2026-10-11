# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through
[GitHub's private vulnerability reporting](https://github.com/adeelahmad/Mock/security/advisories/new)
(Security → Report a vulnerability). Include what you found, how to reproduce it, and the
version (`mock version`, or the commit).

You'll get an acknowledgement within a few days. Fixes ship as a new release, and you're
credited in the advisory unless you'd rather not be.

## Supported versions

Only the latest release and `main` get security fixes.

## What's in scope

- The Mock binary: the sign-in and sync server (OAuth/OIDC, session cookies, the setup token,
  the database), the static file server, and the Google Meet bridge (pairing code, origin checks,
  the local WebSocket).
- The web app: anything that could leak a user's library, their Gemini API key, or run script
  in their browser.
- `install.sh` and the release workflow.

## How Mock handles secrets

- The Gemini API key stays in the browser on each device and is sent only to Google.
- OAuth client secrets are stored on the server and never sent back to the browser.
- The Meet bridge listens on 127.0.0.1 only, accepts only the app's origins, and only after the
  pairing code.

Out of scope: issues that need an already-compromised machine or browser, self-XSS, and missing
hardening headers without a working attack.
