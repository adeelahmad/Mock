# Contributing to Mock

Thanks for helping. Mock is a small, local-first app: a React + TypeScript web app, and an
optional Go binary that embeds it with the sign-in/sync server and the Google Meet bridge.

## Ways to help

- **Try it and report what broke.** A [bug report](https://github.com/adeelahmad/Mock/issues/new?template=bug.yml)
  with the browser, device and what you did is the most useful thing you can send.
- **Share an areas CSV** for an interview loop you know (a company's values, a role's
  competencies) so others can load it. See `site/guide/areas-and-import.md` for the format.
- **Fix something** from the issues labelled `good first issue` or `help wanted`.
- **Ideas** go to [Discussions](https://github.com/adeelahmad/Mock/discussions) first, so we
  can agree on the shape before code is written.

## Set up

Needs Node 22 and, for the binary, Go 1.26+. `make help` lists every target.

```
git clone https://github.com/adeelahmad/Mock && cd Mock
make install           # npm install, devDependencies included
make dev               # the app on http://localhost:5173, demo transport, no key needed
make server            # optional: the Go API on :8787 (sign-in + sync); `make dev` proxies to it
```

No Gemini key? Everything runs on the built-in demo transport, including a full live session.
Settings → Library & data → *Load sample data* fills the library.

## Before you open a PR

```
make check             # typecheck + unit tests + build, then go vet + go test
make e2e               # Playwright against the production build served by bin/mock
```

- Keep PRs focused: one change, with a test where it's testable (pure logic lives in
  `src/domain` and is unit-tested with Vitest).
- The design in `design/` is the spec for the UI. If a change departs from it, say why.
- User-facing changes get a line in the docs site (`site/`) and, if it's a new feature, a page
  under `site/guide` with a sidebar entry in `site/.vitepress/config.ts`.
- Never commit API keys, OAuth secrets, or real interview prep. Fixtures use the sample data.

## Commit and PR style

Plain sentences in the imperative ("Add a hint button to the live screen"). The PR template
asks for a before/after and how you tested; screenshots help for anything visual.

By contributing you agree your work is released under the [MIT License](LICENSE) and that you
follow the [Code of Conduct](CODE_OF_CONDUCT.md).
