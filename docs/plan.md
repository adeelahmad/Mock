# Mock — build plan

Companion to `docs/design-inventory.md`. The design is the spec; this is how it becomes a
local-first PWA. Facts about Gemini and DuckDB-Wasm below were checked against the current docs
on 2026-10-10 (links at the end), not taken from memory.

## 1. Architecture

**Stack.** React 19 + TypeScript + Vite 7, static SPA, installable PWA. No backend; every
Gemini call goes from the browser.

```
src/
  app/            App shell, router (hash routes), theme, toasts, splash, update prompt
  design/         tokens.css (Aladdin + --m-* light/dark), app.css, primitives (Button, Chip,
                  VerdictChip, Seg, Input, Select, Switch, Sheet, Dropzone, icons), Viz
  screens/        Practice, SetupSheet, Live, Library (LPs, LpDetail, Stories, StoryEditor, Grid,
                  Questions, ImportReview, AddQuestion, Files, FilePreview/Editor), History,
                  SessionDetail, Progress, Settings, Onboarding, AnalysisCard, Report
  domain/         pure logic, unit-tested: session state machine, readiness, queue, context builder,
                  parsers (markdown questions/stories/grid, CSV, Exponent), dedup, token budget
  db/             DuckDB-Wasm wrapper, schema + migrations, typed queries, persistence (snapshots
                  to IndexedDB), blob store (IndexedDB), backup/restore (zip + Parquet)
  live/           LiveTransport interface; GeminiLiveTransport (WebSocket); SimulatedTransport
                  (scripted events); audio I/O (AudioWorklet capture, PCM playback, mixer,
                  recorder); session controller (wires transport ↔ state machine ↔ db)
  gemini/         REST client (generateContent / countTokens), analysis + report + tagging calls
                  with JSON schemas, key store
  pwa/            service worker (Workbox), manifest, persistence prompts, wake lock
prompts/coach.md  the system prompt template (verbatim from the brief)
```

**Storage.**
- DuckDB-Wasm holds all structured data and answers every query the UI needs (filters, grid,
  readiness, heatmap, trends, search). Bundle: the `eh` bundle, single-threaded, self-hosted and
  precached (no cross-origin isolation headers needed, so any static host works; threads stay
  off — the docs still call multithreading experimental).
- Persistence: **IndexedDB snapshots**, not OPFS (decision D1). After each write the changed
  tables are exported to Parquet (`COPY t TO 't.parquet'` → `copyFileToBuffer`) and stored in
  IndexedDB, debounced 250 ms, plus a full snapshot on `visibilitychange`/`pagehide`. On start the
  Parquet buffers are registered and loaded back. A `meta` table carries `schema_version`;
  migrations run in order on load; a backup from an older version runs the same migrations.
- IndexedDB blobs: recordings (chunked during the session), per-exchange clips, uploaded
  originals, DuckDB snapshots.
- localStorage (try/catch wrapped): theme, last tab, live layout, voice visual, onboarding flag.
- Gemini key: IndexedDB `secrets` store, never in snapshots, never in backups unless opted in,
  never logged; the settings screen suggests restricting the key to the Gemini API.

**Live connection.** `LiveTransport` interface: `connect(config)`, `sendAudio(pcm)`,
`sendText(tag)`, `sendToolResponse()`, `close()`, and an event stream (`ready`, `audio`,
`inputTranscript`, `outputTranscript`, `toolCall`, `interrupted`, `turnComplete`, `goAway`,
`resumptionUpdate`, `closed`, `error`). Two implementations: `GeminiLiveTransport` and
`SimulatedTransport` (replays a script with timings; the design's self-playing demo is script #1;
tests use smaller scripts). The session controller never knows which one it has.

**State machine.** One explicit machine (`domain/session-machine.ts`, pure, tested):
`idle → connecting → interviewer → answering ⇄ thinking → coaching → interviewer … → ended`, with
`paused` and `reconnecting` as overlays that remember the state underneath, `hint` as a flag.
Inputs are transport events, VAD-derived speech on/off, the transcript sentinels
("Pausing the interview." / "Back to the interview.", matched case- and punctuation-insensitively),
the `new_question` tool, timers, and button tags.

**Context builder.** `domain/context.ts` fills `prompts/coach.md` from DuckDB (session meta,
reports newest-first with older ones summarised, LPs in scope, stories with links and numbers,
questions ordered previous-interview → weak LPs → never-asked, included files), wraps items in
`<file name>`, `<story id>`, `<question id lp>` tags, estimates tokens locally (chars/4, audio at
32 tokens/s) and confirms with `countTokens`, then trims in order: old reports → low-priority
questions → long files (summarised). Budget: 131,072 input tokens on `gemini-3.8-live`, target
≤ 40 k for the system prompt so audio has room. A debug panel shows the count and what was trimmed.

**Analysis and reports.** On exchange close: clip (webm/opus, inline ≤ 20 MB) + transcript +
material → `gemini-3.8-flash` with a JSON schema; pace and duration come from timestamps. The
spoken verdict is extracted from the coaching transcript in the same call and compared with the
card. At session end a second call writes the report (verdicts per LP / interviewer votes,
biggest improvement, top three fixes, story swaps, next focus). Heatmap, readiness, story usage,
trend and the Today queue are DuckDB queries only.

**PWA.** Workbox service worker precaching the build, self-hosted fonts and the DuckDB bundle;
"Update available, reload" instead of silent updates; `navigator.storage.persist()` on first run;
storage use in Settings via `estimate()`; iOS add-to-Home-Screen prompt; backup nudge when the
last backup is older than the last session; offline banner on Practice with Start disabled.

## 2. Verified platform facts (what the code will use)

| Topic | Current docs say | Used as |
|---|---|---|
| Live model | `gemini-3.8-live` (stable; 131,072 in / 65,536 out; audio in/out; function calling, async `NON_BLOCKING` default). `gemini-3.8-live-extended-thinking` also stable. `gemini-3.1-flash-live-preview` is legacy. `gemini-2.0-flash-live-001` (the prototype's default) is **shut down**. | default live model; the Settings select lists the two 3.8 models |
| Flash model | `gemini-3.8-flash` stable; 2.5 models are restricted to past users. | analysis, reports, tagging, model answers |
| VAD | `realtimeInputConfig.automaticActivityDetection{ disabled, startOfSpeechSensitivity, endOfSpeechSensitivity, prefixPaddingMs, silenceDurationMs }` (server default ≈ 800 ms) | `silenceDurationMs` = the Settings pause (default 2000–2500 ms) |
| Transcription | `inputAudioTranscription: {}` / `outputAudioTranscription: {}` → `serverContent.inputTranscription.text` / `outputTranscription.text` | timestamped transcript; coaching sentinels |
| Barge-in | `serverContent.interrupted: true`; pending tool calls cancelled | stop + flush playback |
| Resumption | setup `sessionResumption: { handle }`; server `sessionResumptionUpdate { resumable, newHandle }`; handles valid 2 h; connections last ≈ 10 min | store `newHandle`; reconnect on `goAway.timeLeft` / close |
| Compression | `contextWindowCompression: { slidingWindow: {}, triggerTokens }`; without it audio-only sessions end at 15 min | always on |
| Tools | setup `tools: [{ functionDeclarations: [...] }]`; `toolCall.functionCalls[{id,name,args}]`; reply `toolResponse.functionResponses[{id,name,response}]` | `new_question(interviewer, question, lp, question_id?)` |
| Audio | in: 16-bit PCM 16 kHz `audio/pcm;rate=16000`; out: 24 kHz PCM | AudioWorklet capture, scheduled playback |
| Auth | API key on the WebSocket URL, or an ephemeral token (`POST /v1beta/auth_tokens`, then `access_token`) | key by default; ephemeral token minted in-browser as an option (keeps the key out of the WS URL) |
| Structured output | JSON schema via `responseMimeType`/`responseJsonSchema` on `generateContent`; the docs now also present an Interactions API — verified at M4 before coding | analysis/report/tagging schemas |
| Audio tokens | 32 tokens per second; inline requests ≤ 20 MB | clip budgeting |
| DuckDB-Wasm | stable npm `latest` per the overview; the Sept 2026 OPFS post warns the then-`latest` 1.33.1-dev57 build does not persist and recommends pinning 1.32.0 or `next` ≥ 1.33.1-dev64; OPFS needs `CHECKPOINT` to flush; one handle per file; Safari/iOS OPFS **not documented as supported** | pin a tested version; IndexedDB snapshots (D1) |

## 3. Data model (schema v1)

Tables (DuckDB): `meta(key,value)`, `lp`, `story`, `story_number(story_id,label,value,sort)`,
`story_lp(story_id,lp_id,role)`, `question`, `question_lp(question_id,lp_id)`, `file`, `session`,
`exchange`, `transcript_event(session_id,exchange_id,t_ms,speaker,text)`, `analysis`
(one per exchange, JSON columns for lists), `report`, `setting`. Blobs (IndexedDB): `recording:
{sessionId}`, `clip:{exchangeId}`, `upload:{fileId}`, `snapshot:{table}`, `secrets`.

Enumerations: verdict `strong_hire | inclined | not_inclined | strong_no_hire` (UI order and colours
as in the design); mode `loop | lp | story | question_set | replay | deep_dive | bar_raiser`;
coaching `after_each | recap_only`; question source `previous | common | custom | ai`; file type
`JD | Background | Past interviews | Other`.

**Readiness per LP** (`domain/readiness.ts`, tested): take that LP's exchanges from the last 8
sessions; score verdicts 4/3/2/1; weight each by `0.5 ^ (sessionsAgo / 3)` (half-life three
sessions) so the latest attempt dominates but one bad day doesn't erase a trend; readiness =
weighted mean / 4 in 0..1; `null` when never tested. The display verdict is the latest; the queue
ranks by readiness ascending, then days since practised, then the last report's focus first.

**Seed.** The 16 LPs (names + one-line descriptions, `isDefault`, resettable) and the question bank
from `exponent-bank.json` (source `common`, LP from `lp_id`, untagged rows stay flagged). Sample
stories/sessions from `mock-data.js` are loaded only by a "Load sample data" dev action and by
tests, not on first run (decision D3).

## 4. Milestones

Each ends with tests green, the app running, screenshots compared to the boards, and one commit.

**M1 — Shell and every screen (sample data, simulated transport).** Convert the existing JS
scaffold to TypeScript; tokens; primitives; all screens in the inventory incl. desktop layouts;
the live screen on `SimulatedTransport` with the design's script; state machine with unit tests;
Playwright flows (onboarding → home → live demo → history). Data comes from an in-memory
repository with the same interface the DuckDB layer will implement.

**M2 — Storage, library, imports, backup, offline.** DuckDB-Wasm layer, schema v1 + migrations,
IndexedDB snapshots and blobs, persistence prompt, storage estimate; library CRUD (LPs reset,
stories/editor/grid, questions/filters/add, files/editor); parsers (markdown questions, CSV,
stories incl. story grid, Exponent) with tests; import review and Gemini batch tagging (keyword
fallback offline); dedup; backup zip (manifest + Parquet + uploads + optional recordings),
restore with validation, replace-or-merge, migrations, optional WebCrypto passphrase; download /
Web Share / File System Access; partial exports; service worker with update prompt.

**M3 — Real Gemini Live.** `GeminiLiveTransport` with VAD config, transcription, barge-in flush,
`new_question`, resumption + compression + GoAway reconnect with the reconnecting banner, text
tags for the controls, keyboard shortcuts; AudioWorklet mic, playback scheduler, mixed-track
MediaRecorder written to IndexedDB in chunks, per-exchange clips and chapter markers; iOS
AudioContext resume on gesture, wake lock, device-change handling; context builder with token
counting and the debug panel; "Test · say hello" and voice preview.

**M4 — Analysis, reports, playback, progress.** Flash analysis with schema on exchange close
(card appears live; spoken-vs-card verdict note), session report, suggested focus into Practice;
History player with waveform, chapters, ±15 s, speed, skip-my-answers, synced transcript; Progress
queries (heatmap, readiness, trend, usage) and the Today queue; model-answer sheet.

**M5 — PWA and release.** Manifest, icons, shortcuts, install/iOS prompts, backup nudge, offline
states, mobile pass on iPhone Safari and Android Chrome, static deploy (GitHub Pages workflow),
README.

## 5. Tests

- Unit (Vitest): session state machine (every transition incl. pause/reconnect overlays),
  parsers, readiness + queue, context builder + trimming, dedup, backup manifest/migrations.
- Storage round trip and backup → wipe → restore equality run against real DuckDB-Wasm in
  Playwright (browser), on fixture data.
- Playwright flows on the simulated transport: first run, start a drill, full live demo to the
  recap, review in History, import a markdown question file through review, backup/restore.
- Screenshot comparison against the boards at 390 × 844 and 1440 × 900, light and dark.

## 6. Risks

| Risk | Mitigation |
|---|---|
| iOS Safari: MediaRecorder yields `audio/mp4`, not webm; no OPFS guarantee; background tabs suspend audio | record whatever MIME the browser supports and store it; snapshots to IndexedDB; wake lock + "keep the screen on" copy; test on a real iPhone in M5 |
| Transcript sentinels mis-transcribed ("Pausing the interview" without the full stop) | fuzzy match; the coaching state also opens on the analysis arriving and closes on the next `new_question` |
| Live context budget (131 k) with long files and many reports | the trim ladder + debug panel; files summarised by Flash once and cached in the `file` row |
| Connection ≈ 10 min, session 15 min without compression | compression always on; resumption handle refreshed on every update; reconnect on GoAway before expiry |
| `NON_BLOCKING` tool default: the model may keep talking before `new_question` returns | reply immediately with `scheduling: SILENT`; the UI never waits on the tool result |
| DuckDB-Wasm bundle ≈ 6 MB wasm | precached once; splash shows progress; in-memory fallback if instantiation fails (badge says so, as the design shows) |
| Storage eviction on iOS | `persist()`, add-to-Home-Screen prompt, backup nudge, "Delete all data asks twice" |
| API key exposure in the WebSocket URL | optional ephemeral tokens; key restricted to the Gemini API; never logged |
| Structured-output API shape changing (Interactions API) | verified against the docs at the start of M4; schemas kept in one module |

## 7. Decisions I'd change or need your OK on

- **D1 · Persistence: IndexedDB snapshots, not OPFS.** DuckDB's own OPFS post (Sept 2026) lists
  only "modern browsers" and a broken `latest` build; Safari/iOS support is undocumented and
  third-party reports say OPFS persistence works only on desktop Chromium. The brief asked me to
  propose OPFS only if it is reliable on iOS Safari; it isn't. OPFS can be added later behind a
  flag for Chromium.
- **D2 · Live protocol follows the brief, not the prototype.** The prototype used three tools
  (`ask_question`, `coach_feedback`, `end_session`) and let the live model produce the verdict.
  The brief's `new_question` tool + transcript sentinels + a separate Flash analysis is more
  robust (structured output from a text model, timestamps from the app) and is what I'll build.
- **D3 · First-run data.** First run seeds the 16 LPs and the Exponent bank only. The invented
  stories/sessions in `mock-data.js` become dev fixtures (a "Load sample data" button in Settings
  → Library & data, dev builds only) rather than production seed, so your real library never
  mixes with sample content. The onboarding copy "Skip — start with the sample library" becomes
  "Skip — start with the LPs and the question bank".
- **D4 · The 18 MB Exponent export.** The prototype bundles it and auto-imports it on first run.
  I propose not shipping it in the build: `exponent-bank.json` already holds the distilled bank,
  and 18 MB in every install (and in the repo) is a lot. "Load full Exponent export" stays as a
  button that opens the file picker and streams a `.zst`/`.json` you pick. Say the word and I'll
  bundle it instead.
- **D5 · Model names.** The prototype's `gemini-2.0-flash-live-001` is shut down. Defaults:
  live `gemini-3.8-live`, text `gemini-3.8-flash`. The Settings select stays editable so you can
  type any model id.
- **D6 · Lock-screen widget and Action button.** Not possible from a PWA. Adaptation: manifest
  shortcuts ("Start today's drill", "Review last session") and `#/start` / `#/last` deep links,
  which an iOS Shortcut bound to the Action button can open.
- **D7 · TypeScript.** The first brief said "implement the selected files" and I started a
  JavaScript port of the screens before this brief arrived (it is on the branch, labelled WIP).
  M1 converts it to TypeScript; nothing from it ships untyped.
- **D8 · Voices.** The design's voice list names personas (Dana, Priya, Tomasz, Marcus, Elena) with
  a preview button; Gemini voices have their own names. I'll map each persona to a Gemini voice
  in a table (editable in Settings) and preview with a short TTS-free live turn.
- **D9 · Interviewer personas in a loop.** The brief lets the model invent names; the design
  shows five fixed interviewers with monograms. The app passes the five personas (name, role,
  monogram) into `{{FOCUS}}`-adjacent session meta so the model uses them and the UI can show the
  right monogram from `new_question(interviewer)`.
- **D10 · Seed.** The prototype's "session seed" (reproducible question order and model answers)
  is kept as an advanced row in the setup sheet; it is not in the brief but the design shows it.

## 8. Open questions (answer whenever; defaults in brackets)

1. Bundle the 18 MB Exponent export or import it on demand? [on demand, D4]
2. Default pause before my turn ends: 2.0 s (brief) or 2.5 s (design)? [2.5 s, slider 1–4 s]
3. Coaching style default: after each answer [yes]
4. Should "Test · say hello" set the pause length from how you speak, as the onboarding copy
   suggests? [measure and suggest, don't auto-apply]

## Sources checked
- https://ai.google.dev/gemini-api/docs/live-guide · https://ai.google.dev/gemini-api/docs/live-session · https://ai.google.dev/gemini-api/docs/live-tools · https://ai.google.dev/gemini-api/docs/models · https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live · https://ai.google.dev/gemini-api/docs/ephemeral-tokens · https://ai.google.dev/gemini-api/docs/audio · https://ai.google.dev/gemini-api/docs/tokens · https://ai.google.dev/gemini-api/docs/structured-output
- https://duckdb.org/docs/current/clients/wasm/overview.html · https://duckdb.org/2026/09/18/opfs-wasm
