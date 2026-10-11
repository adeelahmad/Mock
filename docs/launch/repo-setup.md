# Repo setup: the settings only the owner can change

These live in GitHub's settings, not in the code, so a PR can't set them.

## 1. Visibility and default branch

The repo is public and its default branch is `main` (checked 2026-10-11), so nothing to do here.
A quick scan of the history for API keys and private keys found none. The old
`feat/sharp-feynman-ra7w22` branch can be deleted.

GitHub listed the repo's language as **HTML** because of the Claude Design export in `design/`.
`.gitattributes` now marks `design/`, `site/` and `docs/` as documentation, so the language bar
(and the Trending language pages) should show Go and TypeScript after the next push to `main`.

## 2. About (the gear next to "About" on the repo page)

**Description** (≤350 chars):

> Rehearse the interview out loud. A live voice interviewer (Gemini Live) asks the questions and
> follows up; between answers a coach tells you what to fix, judged against your own stories and
> numbers. Local-first PWA, one Go binary to self-host, works in Google Meet.

**Website:** `https://adeelahmad.github.io/Mock/`

**Topics** (GitHub allows 20):

```
interview-prep  mock-interview  interview  behavioral-interview  star-method  career
gemini  gemini-live  voice-ai  ai-coach  speech  google-meet
pwa  local-first  self-hosted  golang  react  typescript  duckdb  offline-first
```

Tick **Releases** and untick **Packages** and **Deployments** if they're empty.

## 3. Social preview

Settings → General → **Social preview → Edit → Upload an image**: `.github/assets/social-preview.png`
(1280×640 PNG). This is what X, Slack, LinkedIn and Discord show when the repo link is shared.

## 4. Pages

Settings → Pages → **Source: GitHub Actions**. The `Pages` workflow then publishes the docs at
`https://adeelahmad.github.io/Mock/` and the app at `…/app/` on every push to `main`. The README's
"Try the demo" and "Docs" links point there.

Earlier Pages runs failed in seconds without starting a job, which points at Actions settings or
billing. Public repos get Actions and Pages free; if runs still fail to start, check Settings →
Actions → General (Actions allowed) and Settings → Billing.

## 5. Features

Settings → General → Features:

- **Discussions: on.** The issue chooser sends questions there. Create categories *Q&A*,
  *Ideas*, *Show and tell* (people sharing their areas CSVs).
- **Issues: on.** Add labels `good first issue` and `help wanted` to a few small issues before
  launch; GitHub surfaces them to new contributors.
- **Private vulnerability reporting: on** (Settings → Code security). `SECURITY.md` points to it.

## 6. First release

Tag it; the `Release` workflow builds the four binaries and publishes them with checksums:

```
git tag v0.1.0 && git push origin v0.1.0
```

Then check `curl -fsSL https://raw.githubusercontent.com/adeelahmad/Mock/main/install.sh | sh`
on a clean machine, and that the README's release badge shows `v0.1.0`.

## 7. Pin it

Pin the repo on your GitHub profile (Profile → Customize your pins).

## Trending checklist

- [x] Public, default branch `main`
- [ ] About description, website, topics
- [ ] Social preview uploaded
- [ ] Pages on and the demo link works
- [ ] `v0.1.0` released; `install.sh` works on Linux and macOS
- [ ] Discussions on; 3–5 issues labelled `good first issue`
- [ ] Private vulnerability reporting on
- [ ] Pinned on your profile
- [ ] Launch posts out the same morning (see `launch-plan.md`), and you're around for the
      first few hours to answer comments
