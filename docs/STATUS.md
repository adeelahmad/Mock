# Mock — status and handoff

Last updated 2026-10-11 (session 2). Work branch: `claude/project-thread-muhi9a` → PR into `main`.
GitHub may still list `feat/sharp-feynman-ra7w22` as the default branch — switch it to `main` in
Settings → General, then delete the old branch.

## Where things stand

| Milestone | State |
|---|---|
| Plan (`docs/plan.md`, `docs/design-inventory.md`, `prompts/coach.md`) | done, approved ("ok") |
| **M1** — shell, tokens, every screen on sample data + simulated transport | **done** (see below) |
| **M2** — DuckDB-Wasm, IndexedDB, library CRUD, imports, backup zip, service worker | **done** (see below) |
| M3 — real Gemini Live transport, recording, context budget | not started |
| M4 — Flash analysis, reports, History playback from recordings, Progress queries | not started |
| M5 — PWA install, mobile pass, static deploy, README | not started |

Verified at the last commit: `npm run typecheck` 0 errors · `npm test` 101 unit tests green
(state machine 14, readiness/queue 8, parsers 36, context builder 6, controller 2, Repo contract
on memory + DuckDB 20, persistence/migrations 4, backup/merge 8, tagging + .zst 3) ·
`npm run e2e` 31 Playwright flows green (phone + desktop + the built PWA offline) ·
`npm run build` OK (app ≈ 560 kB JS / 179 kB gzip; DuckDB loads on demand: 193 kB glue + 34 MB
`eh` wasm, 7.7 MB gzip, precached by the service worker).

## M2 — what landed (session 2)

- **Storage** (`src/db/`): `schema.ts` (schema v1 tables per plan §3, `migrationsBetween`,
  `ddlAt`), `engine.ts` (SQL engine interface) with `engine-browser.ts` (DuckDB-Wasm **1.32.0
  pinned**, `eh` bundle + `mvp` fallback, self-hosted, single-threaded, no network extension
  loads) and `engine-node.ts` (the blocking build, unit tests only), `duck.ts` (`DuckRepo`: the
  same `Repo` interface as `MemoryRepo`; every call serialised; multi-row parameterised inserts),
  `snapshots.ts` (Parquet per changed table → IndexedDB, debounced 250 ms, one transaction per
  flush, full flush on `pagehide`/hidden; load → migrations), `kv.ts` (IndexedDB stores
  `snapshots`, `blobs`, `secrets`), `open.ts` (picks the repo; DuckDB failure → in-memory with
  the same seed, badge says "in-memory library").
- **First run** seeds the 16 LPs + `public/exponent-bank.json` (233 questions) into DuckDB (D3).
  `navigator.storage.persist()` is asked on finishing first run; Settings shows usage/quota and
  whether storage is persistent.
- **URL switches** for dev/tests: `?repo=sample` (in-memory sample library — the Playwright flows
  and `npm run shots` use it) and `?repo=memory` (in-memory, empty). Default is DuckDB.
- **Backups** (`backup.ts`, `screens/BackupSheets.tsx`): a zip with `manifest.json`, `data.json`
  (the canonical document restore reads), `tables/*.parquet` (DuckDB builds), uploads,
  optional recordings and `blobs.json`. Scope: everything / library only / sessions only.
  Optional passphrase seals the zip (PBKDF2-SHA-256 210k → AES-GCM; `.mockbackup`). Save via
  Download, "Save to…" (File System Access) or "Share…" (Web Share) as the browser allows.
  Restore validates, migrates older documents, then **Replace** or **Merge** (questions/stories
  deduped, newer edits win, clashing session numbers renumbered by start time). M1 JSON backups
  still restore. The Gemini key is never in a backup.
- **Imports**: `.zst` Exponent exports decode with fzstd (Library → Upload, first-run drop);
  `importPrepFiles` moved to `src/domain/prep-import.ts`, `useHelloTest` to `src/app/hello.ts`,
  `keyClick` to `components/ui.tsx`. With a Gemini key, Library imports send the rows the
  keyword tagger is unsure of to `gemini-3.8-flash` in batches (`src/gemini/tagging.ts`,
  JSON schema, key in the `x-goog-api-key` header); offline or on error the keyword tags stand.
- **PWA**: `vite-plugin-pwa` (Workbox `generateSW`, `registerType: 'prompt'`) precaches the
  build, self-hosted fonts (`@fontsource-variable/dm-sans`, `jetbrains-mono` — Google Fonts
  removed) and the DuckDB `eh` wasm; "Update available · Reload" toast, never mid-session.
  Minimal manifest (icons, shortcuts, install prompts are M5).
- **Not in M2** (left for later, say if you want them sooner): `.docx` import (still skipped
  with a message); `Dropzone` folder walking; the backup nudge (M5).

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
npm run shots          # app screenshots (dev server must be running; uses ?repo=sample)
npx vite preview       # the production build with the service worker (after npm run build)
```

The e2e run starts the dev server (:5173) and a built preview (:4173, the `pwa` project).

Dev-only: Settings → Library & data → "Load sample data" (plan D3: first run seeds only the
16 LPs and the Exponent bank; the invented stories/sessions are fixtures).

## Decisions in force (docs/plan.md §7)

D1 IndexedDB snapshots, not OPFS · D2 brief's live protocol (`new_question` + sentinels +
Flash analysis) · D3 sample data is dev-only · D4 the 18 MB Exponent export is not bundled ·
D5 `gemini-3.8-live` / `gemini-3.8-flash` · D6 lock-screen widget → PWA shortcuts ·
D7 TypeScript · D8 persona → Gemini voice map (`src/domain/voices.ts`) · D9 five fixed
interviewers · D10 session seed kept. Open questions in plan §8 still default.

## Next session, suggested order

1. M3 per plan §4: `GeminiLiveTransport` (VAD, transcription, barge-in, `new_question`,
   resumption/compression/GoAway), AudioWorklet mic + playback, MediaRecorder chunks into the
   `blobs` store, context builder token counting + trim + debug panel, real "say hello".
2. M4, M5.
