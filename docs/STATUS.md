# Mock — status and handoff

Last updated 2026-10-10 (end of session 1). Branch: `main` (the feature branch was renamed; GitHub
still lists `feat/sharp-feynman-ra7w22` as the default branch — switch it to `main` in
Settings → General, then delete the old branch).

## Where things stand

| Milestone | State |
|---|---|
| Plan (`docs/plan.md`, `docs/design-inventory.md`, `prompts/coach.md`) | done, approved ("ok") |
| **M1** — shell, tokens, every screen on sample data + simulated transport | **done** (see below) |
| M2 — DuckDB-Wasm, IndexedDB, library CRUD, imports, backup zip, service worker | not started |
| M3 — real Gemini Live transport, recording, context budget | not started |
| M4 — Flash analysis, reports, History playback from recordings, Progress queries | not started |
| M5 — PWA install, mobile pass, static deploy, README | not started |

Verified at the last commit: `npm run typecheck` 0 errors · `npm test` 66 unit tests green
(state machine 14, readiness/queue 8, parsers 36, context builder 6, controller end-to-end 2) ·
`npm run build` OK (≈ 502 kB JS, 156 kB gzip).

## What M1 contains

- `src/domain/` — types (schema v1), verdict scale, **session state machine** (pure reducer,
  tested), **readiness + practice queue** (half-life weighting, tested), selectors (LP/story/
  question rows, heatmap, trend, weakest answer), **parsers** (markdown/CSV questions, stories,
  story grid, Exponent JSON, keyword LP tagger, dedup; tested), voices/models.
- `src/live/` — `LiveTransport` interface, **SimulatedTransport** (replays
  `scripts/demo.ts`: two questions, follow-ups, a reconnect, coaching sentinels, recap →
  `sessionEnd`), `SimulatedAnalyzer`, the **session controller** (transport → machine → repo;
  `new_question` opens/closes exchanges; transcript persisted; analysis on coaching start),
  the context builder over `prompts/coach.md` (fill + question priority; trimming is M3).
- `src/db/` — `Repo` interface, **MemoryRepo** on typed sample fixtures, JSON backup build/restore.
- `src/app/` — hash router, theme (light/dark/system), prefs, store (`useApp()`), shell
  (phone tab bar / desktop sidebar), sheets close on navigation.
- `src/screens/` + `src/components/` — every screen in the inventory: Practice home (3b) with
  the Today queue, setup sheet (3 decisions + "Something else" page), model-answer sheet (local
  STAR composition until M4), add question/story, **Live** (every state, three phone layouts,
  two desktop panels, keyboard shortcuts, demo banner), Library (LPs/Stories/Questions with the
  design's filters/Files), import review, import stories, LP detail (desktop master-detail),
  story editor, Story × LP grid, file preview/editor, History + session detail with the
  chapter player (virtual clock until recordings exist) and analysis cards, Progress, Settings,
  first run.
- `design/` — the Claude Design export (boards + design system; no uploads). `npm run refs`
  renders every artboard light/dark to `tests/design-refs/` (git-ignored).
- `scripts/app-shots.mjs` (`npm run shots`) — screenshots every app route phone/desktop,
  light/dark into `tests/screenshots/` (git-ignored) for comparison with the refs.
- `tests/e2e/` — Playwright flows (first run, live demo to recap, library, history, progress,
  settings). **Written, not yet run** — run `npm run e2e` with `PW_CHROMIUM=/opt/pw-browsers/chromium`
  on this box (the installed Chromium is older than the Playwright package) and fix selectors.

## M1 — closed (session 2, 2026-10-11)

- **Playwright flows green**: 22/22 (phone + desktop). The live screen exposes its phase as
  `.live[data-phase]` (`connecting · interviewer · answering · thinking · coaching · end`);
  helpers and `scripts/app-shots.mjs` read that. Desktop has no Hint handle (key `H`) and shows one
  analysis card until "All N".
- **Visual review** done for every route, sheet, live state, onboarding 1–3 and dark desktop.
  Fixed: the voice visual shows "nobody" while connecting and in the thinking pause; "1 turn"
  pluralised and the phone handle row fits Transcript · Notes · Hint · Feedback at 390 px; grid
  subtitle and desktop panel order match the board; story-editor fields grow with their text.
  `npm run shots` now also captures onboarding steps 2–3.
- **Deviations kept** (deliberate): home weakest card "Redo · {LP}"; session card sub-line;
  Library DB badge as a footnote; story editor "Saved" until dirty and a one-line summary field;
  real parser counts in file preview; Progress "Readiness · now" phone-only; `.zst` toast until
  M2; sample session 14 has 9 exchanges; onboarding step 2 keeps the Gemini key + model fields
  (the hello test needs them) above the persona picker; step 3 adds a Status box; desktop
  Library → LPs opens with an empty detail pane until an LP is picked; the coaching eyebrow
  (Q · LP · interviewer's question) also shows on desktop.
- Optional refactors still open: move `importPrepFiles`/`useHelloTest`/`keyClick` out of
  `Settings.tsx`; `Dropzone` folder walking; `paths.answer()` deep links.

## How to run

```
npm install            # dev deps need --include=dev if NODE_ENV=production
npm run dev            # http://localhost:5173
npm run typecheck · npm test · npm run build
PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e
npm run refs           # design artboards → tests/design-refs (needs network for unpkg/fonts)
npm run shots          # app screenshots (dev server must be running)
```

Dev-only: Settings → Library & data → "Load sample data" (plan D3: first run seeds only the
16 LPs and the Exponent bank; the invented stories/sessions are fixtures).

## Decisions in force (docs/plan.md §7)

D1 IndexedDB snapshots, not OPFS · D2 brief's live protocol (`new_question` + sentinels +
Flash analysis) · D3 sample data is dev-only · D4 the 18 MB Exponent export is not bundled ·
D5 `gemini-3.8-live` / `gemini-3.8-flash` · D6 lock-screen widget → PWA shortcuts ·
D7 TypeScript · D8 persona → Gemini voice map (`src/domain/voices.ts`) · D9 five fixed
interviewers · D10 session seed kept. Open questions in plan §8 still default.

## Next session, suggested order

1. M2 per plan §4 (DuckDB-Wasm repo behind the same `Repo` interface; pin a tested
   duckdb-wasm version; Parquet snapshots to IndexedDB; migrations; zip backups; service worker).
2. M3, M4, M5.
