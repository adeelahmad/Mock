# Mock — design inventory

Source: Claude Design project `86b9cf0c-3d30-4544-b5c0-f8e775ffb2c9` ("Mock"), delivered as the
`Design_system_setup_questions.zip` export (32 files, 24 MB). Every file was read in full.
The design is the source of truth for look, layout, copy and states. Where it is silent, the
Aladdin design system applies.

Dispositions used below:

| Code | Meaning |
|---|---|
| **BUILD** | a screen or component to build |
| **TOKENS** | design tokens to carry over |
| **DATA** | sample or seed data |
| **LOGIC-REUSE** | simulated logic to reuse (ported, possibly typed) |
| **LOGIC-REPLACE** | simulated logic to replace with a real implementation |
| **SCAFFOLD** | presentation scaffolding, not shipped |

## Part 1 — Files

### Boards (the spec)

| File | What it is | Disposition |
|---|---|---|
| `Mock.dc.html` | Overview board: product one-liner, links to boards 0–5, the **Decisions** list (one-tap defaults, light-first, two mode accents, four-colour verdict scale with glyphs, DM Sans + JetBrains Mono, 390×844 artboards, components defined once) and the **Assumptions** (SDM loop on 30 Oct, session 14 is current, five interviewers, 13/16 LPs covered, hands-free live screen, LP hidden in a full loop). | **BUILD** (as rules; no screen of its own) |
| `Mock - Foundations.dc.html` | Board 0: wordmark (DM Sans 800 + gold dot), colour roles (gold = interview, blue = coaching, green = proof, gray = evidence), verdict scale (✓ ◆ ● ✕ ○ chips, heat cells 40px phone / 28px grid, 10px readiness dots, mini strip), type scale (question 28/700, screen title 32/800, body 15, secondary 13, micro label 11 caps, timer mono 48, counts mono 22, key numbers mono 12), the three voice visuals (orb, waveform, ring) × (interviewer, nobody, coach), buttons & controls (Start, Hint, Redo, Pause, Resume, Feedback, Next; Aladdin form components remapped to dark), chips/cards/avatars/forms (LP, mapping, source, filter chips; missed-number chip; monogram avatars whose border takes the mode colour while that voice speaks; plain card; coaching panel; interview panel; evidence box), navigation (tab bar + desktop sidebar incl. "Interview · 19 days"), the analysis card. Light and dark side by side. | **TOKENS** + **BUILD** (primitives) |
| `Mock - Practice.dc.html` | Board 1: three home directions (3a readiness-first, **3b start-first — canonical**, 3c coach-led plan), the setup sheet ("3 decisions": what / coaching / go, with the "More · remembered" row), the "Something else" sheet (One LP, One story, Question set, Replay a past interview, Deep dive, Bar raiser), the lock-screen widget + Action button. | **BUILD** (3b is the home; 3a/3c elements feed Progress/queue) |
| `Mock - Live Session.dc.html` | Board 2: the self-playing live flow, every state side by side (12 artboards), three layouts (stage, transcript-first, split), two desktop layouts (answering with transcript + notes on the right; coaching with the analysis card on the right), keyboard shortcuts. | **BUILD** |
| `Mock - Library.dc.html` | Board 3: LPs list, LP detail, stories cards, story editor, story × LP grid, import stories (markdown review), questions bank with filters, import review, add question, files list with drop zone, file preview, file editor, desktop master-detail and desktop grid. | **BUILD** |
| `Mock - History & Progress.dc.html` | Board 4: history list with filters, session detail (report, player, synced transcript), session analysis cards, progress heatmap, progress trend; desktop history with waveform/chapter player; desktop progress. | **BUILD** |
| `Mock - Settings & Onboarding.dc.html` | Board 5: three onboarding steps (drop, say hello, start); settings top (interview date, loop size, live model, voice list with preview, pause slider) and bottom (system instruction, appearance, library & data, version line). | **BUILD** |

### Components

| File | What it is | Disposition |
|---|---|---|
| `AnalysisCard.dc.html` | The analysis card component with its data contract (`q, question, lp, story, verdict, better?, reason?, missed[], star{s,t,a,r}, iPct, pace, paceNote, fillers, length, lengthNote, strength, fixes[]`) and a `compact` variant. Footer: Play answer, Save as best attempt, Drill {LP}. | **BUILD** (ported to `AnalysisCard.tsx`; contract becomes the `Analysis` type) |
| `AnalysisCard.standalone-src.html` | The same card as a standalone page (bundler thumbnail template + the card source). Identical content to `AnalysisCard.dc.html`. | **SCAFFOLD** (reference only) |
| `Mock Analysis Card.html` | 877 KB "Bundled Page": the design tool's self-contained export of the card (runtime + fonts inlined). | **SCAFFOLD** (do not ship) |
| `LiveScreen.dc.html` | The live screen: header, accent edge, 9 states, 3 layouts, 3 voice visuals, hint, notes peek, transcript sheet, pause overlay, controls, recap. Two modes: `driven` (props from the app) and `live` (self-scripted demo with two questions and a five-interviewer recap). | **BUILD** (ported to `LiveScreen.tsx`); the scripted demo becomes the **simulated transport**'s script |
| `Mock App.dc.html` | The working prototype: one 390×844 screen set (Practice, Library, LP, story, grid, file, History, session, Progress, Settings, onboarding) on top of `mock-db.js`, plus the live session driver (Gemini Live with `ask_question` / `coach_feedback` / `end_session` tools), model-answer sheet, bank import, backups, recordings, seed. | **BUILD** (screens) + **LOGIC-REPLACE** (session driver, tools, analysis: superseded by the brief's `new_question` tool, transcript sentinels and the separate Flash analysis) |
| `ios-frame.jsx` | iPhone bezel, status bar, nav bar, glass pill, list, keyboard (`IOSDevice` etc.). | **SCAFFOLD** (artboard chrome; never shipped) |
| `support.js` | The design tool's runtime (`DCLogic`, `<x-dc>`, `sc-if`, `sc-for`, `x-import`, `dc-import`, `style-hover`). | **SCAFFOLD** (replaced by React) |

### Logic modules

| File | What it is | Disposition |
|---|---|---|
| `mock-data.js` | Invented sample content: `VERDICTS` (label, glyph, colours), 16 `LPS` (names + one-line descriptions), 10 `STORIES` (STAR for one), 5 `INTERVIEWERS`, 14 `QUESTIONS`, 8 `SESSIONS`, `HEAT` (16×8), 3 `ANALYSES`, `TODAY_QUEUE`, `FILES`, `COVERAGE`. | **DATA** — dev/test fixtures and Playwright seed only. The 16 LP names + descriptions and the `VERDICTS` table are also the production seed. |
| `mock-db.js` | DuckDB-Wasm (jsDelivr) with in-memory fallback; 8 tables seeded from `mock-data.js`; snapshot to IndexedDB (localStorage fallback) 150 ms after each write; blobs store for recordings; backup export/import as JSON; reads (`lps`, `stories`, `questions`, `files`, `sessions`, `answers`, `heat`, `settings`) and writes. | **LOGIC-REPLACE**. Good ideas kept: debounced snapshot-to-IndexedDB, the blob store, the query shapes. Replaced because it has no schema version/migrations, no exchanges/analyses/reports tables, string-built SQL, JSON snapshots instead of Parquet, no OPFS/persistence strategy, and the DuckDB bundle is loaded from a CDN (not precacheable). The new `db/` layer keeps the same read API names so the ported screens need few changes. |
| `mock-live.js` | `GeminiLive` WebSocket client (BidiGenerateContent, 16 kHz PCM in via ScriptProcessor, 24 kHz PCM out, transcripts, tool calls, MediaRecorder of the mic) and `generateText` (REST generateContent with seed). `VOICES`, `MODELS` (2.0-flash-live: now shut down). | **LOGIC-REUSE** as the starting point of the real transport: setup/stream/playback are right. Rewritten in TypeScript behind the `LiveTransport` interface with: AudioWorklet instead of ScriptProcessor, VAD config, session resumption, context compression, GoAway handling, barge-in flush, mixed-track recording, current model ids. `generateText` becomes `gemini/rest.ts`. |
| `mock-import.js` | Streams an Exponent `.zst`/`.json` export in the browser (fzstd from CDN), keeps behavioural questions, dedups, tags LPs by keyword (`guessLp`). | **LOGIC-REUSE**: keyword tagger and the streaming scanner are kept (typed, fzstd bundled, keyword tags become the "fallback" before the Gemini batch tagging). |

### Data

| File | What it is | Disposition |
|---|---|---|
| `exponent-bank.json` | 233 behavioural questions extracted from the first (4 MB) Exponent upload. Shape: `{id:"x653", text, lp_id ("" when untagged; 10 of 16 LP ids used), source:"exponent", difficulty 1–3, tags:"Amazon, Opendoor…", votes, amazon:boolean, sample:"top community answer…"}`. 98 are tagged `amazon:true`. | **DATA** — the first-run question seed, imported as `source: common`, LP tag from `lp_id` (untagged rows stay flagged), `tags`/`votes`/`amazon`/`sample` kept as metadata. |
| `uploads/exponent_new_qa.json.zst` (4 MB) | The upload `exponent-bank.json` was derived from. | **DATA** — not shipped (already distilled). |
| `uploads/exponent_new_qa.json-a408b1cb.zst` (18 MB) | The full Exponent export; the prototype streams it on "Load full Exponent export" and once on first mount. | **DATA** — importable through the file picker; see plan decision D4 on whether to bundle it. |
| `.thumbnail` | WebP preview of the project. | **SCAFFOLD** |

### Design system (`_ds/aladdin-design-system-…/`)

| File | What it is | Disposition |
|---|---|---|
| `styles.css` | Entry; `@import`s the five token files. | **TOKENS** |
| `tokens/colors.css` | Aladdin brand/semantic/surface/border/terminal colours (`--aladdin-blue`, `--intent-surface`, `--border`, `--term-*` …). | **TOKENS** (carried verbatim; Mock's `--m-*` palette from the boards layered on top, light and dark) |
| `tokens/typography.css` | `--font-sans` DM Sans, `--font-mono` JetBrains Mono, `--font-hand` Caveat, `--font-brand` Aladin; weights, scale, line heights, tracking, semantic roles. | **TOKENS** (Caveat/Aladin not used by Mock; not loaded) |
| `tokens/spacing.css` | 4-px spacing scale, radii (xs 4 … xl 24, pill), container, control heights. | **TOKENS** |
| `tokens/effects.css` | Shadows 1–3 (neutral, low), focus ring, glass, easing (`cubic-bezier(.2,0,0,1)`), durations 120/200/320 ms. | **TOKENS** |
| `tokens/fonts.css` | Google Fonts `@import` for DM Sans, JetBrains Mono, Caveat, Aladin. | **TOKENS** (self-hosted woff2 for DM Sans + JetBrains Mono so the PWA precaches them) |
| `_ds_bundle.js` | Compiled React components: Button, IconButton, Badge, PhaseDot/Signature, Panel, ArtifactList, Terminal, LoopStepper, GateVerdict, AgentChip, Input, Select, Checkbox, Switch, Tabs, Dialog, Toast. The boards use **Input, Select, Switch** (and Button/Toast conventions). | **BUILD** (Input, Select, Switch re-implemented in TS with the same look; the rest are Aladdin-specific and unused) |
| `_ds_manifest.json`, `_adherence.oxlintrc.json`, `readme.md` | DS catalogue, lint config for the design tool, Aladdin brand guide (voice, colour semantics, radii, shadows, motion, iconography = Lucide-style 2 px strokes, no emoji). | **SCAFFOLD** (readme rules are followed where the Mock boards are silent) |

## Part 2 — Feature checklist

Everything the design shows. ☐ = to build. Items marked **(web)** need an adaptation on the web
platform and are called out in `docs/plan.md`.

### Foundations (tokens and primitives)
- ☐ Light theme (default) and dark theme (`[data-theme=dark]`, Aladdin terminal palette); Appearance: Light / Dark / System.
- ☐ Two mode accents only: gold = interview, blue = coaching; carried by the top edge, the voice visual and the primary button.
- ☐ Verdict scale with glyphs and colours: ✓ Strong hire (green), ◆ Inclined (blue), ● Not inclined (gold), ✕ Strong no hire (red), ○ Not yet (gray, dashed). Chip, heat cell (40 px phone / 28 px grid), readiness dot (10 px), mini strip.
- ☐ Type: DM Sans everywhere; JetBrains Mono with tabular figures for timers, counts and key numbers.
- ☐ Voice visual × 3 (orb, waveform, ring) × (interviewer gold, nobody gray, coach blue, me ink), animated per speaker; selectable.
- ☐ Buttons: primary gold pill (Start 64 px), blue coaching primary, ink, outline, ghost, danger (End), round thumb-zone controls (Redo 54, Pause 72, Next 54), link buttons.
- ☐ Chips: LP, mapping role (primary ink / secondary outline), source, filter (ink when on), missed-number chip (notes → said in red), key-number mono pills.
- ☐ Cards: plain (white, hairline, 16 px), coaching panel (blue tint), interview panel (gold tint), evidence box, nested boxes 12 px.
- ☐ Monogram avatars (abstract, no photos); border takes the mode colour while that voice speaks.
- ☐ Forms: Input (text, password, multiline, mono), Select, Switch, Checkbox, range slider, date input, drop zone.
- ☐ Navigation: phone tab bar (Practice, Library, History, Progress); desktop sidebar (wordmark, four sections with Library sub-items, "Interview · N days", Settings).
- ☐ Motion: calm 120–320 ms, `mock-in` rise, ping/pulse/breathe/bar/idle/blink keyframes; reduced-motion respected.
- ☐ Analysis card (full and compact).

### Practice (home, 3b canonical)
- ☐ Header: wordmark, "N days" pill (to interview date), Settings button.
- ☐ "Session N · chosen for you" card: focus LP drill, why (verdict + last practised), "up to 3 questions · coaching after each"; **Start** (64 px); Change · Full loop; status line ("Live · voice · mic granted" / "Demo until you add a Gemini key").
- ☐ "Fix your weakest answer" card: verdict chip, question, **Redo · LP** button.
- ☐ Readiness strip: 16 cells (tap → LP detail), N/16 covered · gaps (tap → grid), LP short labels.
- ☐ From 3a/3c (feed the queue and Progress): "Today · 37 min · tap any row to start there" queue (LP, why, minutes, verdict); "Loop readiness" (LPs covered); weakest-first list; "Good morning / Today's plan / Swap / Weakest first / All 16".
- ☐ Lock-screen widget and Action button **(web)**: not possible in a PWA; adapted as manifest shortcuts + a `?start` deep link (plan D6).

### New session setup sheet ("3 decisions")
- ☐ 1 · What: suggested drill (verdict glyph tile, "Suggested · 3 questions · 12 min"), Full loop ("5 interviewers · ~50 min"), Something else (→ second sheet).
- ☐ Something else: One LP (pick LP), One story (pressure-test; mapped LP chips; "Used 9 times — the coach will push you to vary it · Change story"), Question set (pick set), Replay a past interview, Deep dive, Bar raiser; Start with "~18 min".
- ☐ 2 · Coaching: After each answer / Recap only.
- ☐ "More · remembered": question source (mix of sources), story notes on/off, interviewer; the prototype's Session seed (number input + ↻) and "Remembered · Voice · model · Change".
- ☐ 3 · Go: Start (60 px).

### Live session
- ☐ States, each driven by real events: connecting (mic ready, earbuds, "nothing to tap"), interviewer speaking (question types in word by word, blinking caret), me answering (ink visual, mono timer, "Your answer"), thinking pause ("Still listening — coaching starts when you're done"), 3:00 cue (timer and note turn gold: "3:00 passed · start wrapping up"), hint (dismissible gold-bordered nudge naming a story), coaching (accent flips to blue; strength, up to three fixes and the verdict chip arrive one by one; "Coach is speaking…"; "Full analysis →"), paused (scrim, "Mic off · timer held", Resume big, End small), reconnecting (non-blocking gold banner, answer keeps recording), end (recap: duration / questions / fixes to drill, verdict per interviewer, suggested focus, "Start session N+1", "Review in History").
- ☐ Header: monogram with mode-coloured border, "Interviewer N of 5 · role" / "Coach · after Q3" / "Session N · complete", name, LP chip in One-LP mode only (hidden in a full loop until coaching), End.
- ☐ Three layouts: Stage (default), Transcript-first (pinned question, two-sided bubbles, compact "now" row), Split (speaker card with waveform band, question below).
- ☐ Controls: Transcript · N turns (sheet), Notes (story-notes peek, only when the session setting allows), Hint; Redo / Pause / Next round buttons; "Hands-free: say "redo", "next" or "hint"."; coaching: Redo answer (blue) / Next question ("auto in 5 s · say "redo" to retry" or "or just say "next""); Feedback control.
- ☐ Transcript sheet: pinned question, bubbles with monogram, close.
- ☐ Desktop: answering with transcript + story notes on the right ("hidden from the interviewer"), elapsed time, keyboard hints (Space pause · R redo · N next · H hint · Esc end); coaching with the analysis card on the right ("saved to History").
- ☐ Demo banner when no key: "Demo · add a Gemini key in Settings to go live" (scripted run on the simulated transport).

### Library
- ☐ Header: "Library", DB status badge, segmented LPs / Stories / Questions / Files.
- ☐ LPs: 16 rows (name, "N stories · N questions · last", verdict chip); "Reset to defaults" (desktop).
- ☐ LP detail: name, verdict chip, description, Edit, mapped stories (title, numbers, primary/secondary role; "Map a story in the grid →"; "+ Add"), question bank for the LP (ask it now, ✦ model answer, last verdict glyph; "+ Add", "Upload"), verdict history (8 sessions), best attempt row (play, "session 12 · 2:48", story, verdict, quote), **Practise this LP**.
- ☐ Stories: count · N/16 LPs covered, Story × LP grid button, "+ Story", "Import markdown"; cards (title, verdict chip, summary, key-number pills, LP short chips, "used N×" gold when over-used).
- ☐ Story editor: title, Situation / Task / Action / Result / Learning, key numbers, LP mapping chips ("tap the grid to change"), **Pressure-test this story**; save; delete.
- ☐ Story × LP grid: N of 16 covered + bar, one tap cycles none → primary → secondary, gap row (gold), legend, "Over-used" and "Gaps" panels, used ×N column (desktop).
- ☐ Import stories (markdown review sheet): "stories.md · 4 found", each `## heading` → story, STAR + numbers detected, suggested LPs, status (New · 3 numbers found / Duplicate · skip / New · no numbers), "Import 3 stories · skip 1 duplicate".
- ☐ Questions: filter chips (LP ▾, source e.g. "Previous interview ✕", Difficulty ▾, Not asked, Last verdict ▾; prototype adds All / Asked at Amazon / Mine / Asked / Untagged), "92 questions · 5 from previous interviews", rows (text, LP chip — gold when untagged, source · difficulty · asked N×, verdict chip, ✦ Model answer), tap to ask it now, Show more, Import file, "Load full Exponent export" with progress, "+ Add".
- ☐ Import review: "12 questions found · file · tagged "Previous interview" · 2 already in your bank", "10 tagged with confidence" (green), "2 need you · or leave them flagged" with suggested-LP chips, **Save all 12**, "Unresolved tags stay flagged — never a blocker", Cancel.
- ☐ Add question sheet: question, LP ("Suggested · change"), source, difficulty segmented, **Save to bank** / **Save & ask now**.
- ☐ ✦ Model answer sheet: "Model answer · seed N · From your own stories", STAR answer written by Gemini from the candidate's stories, top community answer (Exponent), "Another take · new seed", "Ask me this live".
- ☐ Files: drop zone ("Type is detected from content; questions inside are added to the bank"), rows (mono name, type chip JD / Background / Past interviews / Other, size · updated, include switch).
- ☐ File preview: Preview / Edit toggle, rendered markdown, "Mock found · 5 questions · 2 verdict hints · 1 story reference", **Import 5 questions**, **Replay this loop**.
- ☐ File editor: mono editor, "Saved · just now", Done; remove file.
- ☐ Desktop: sidebar + 440 px master list + detail; grid full-width.

### History
- ☐ List: "History" + search, filters (All · 14, Full loop, One LP, …), rows (Session N, date, mode · duration, verdict mini-strip); a verdict cell is a link to that answer's playback and card.
- ☐ Session detail: Session N, date · mode · duration · N answers (· N interviewers), Export (▾: Markdown + audio), verdict tiles per answer with LP shorts, "Focus next", recording player (waveform, chapters Q1…Q5 with LP, position / total, ±15 s, play/pause, 1.5×, "Skip my answers", Download), Transcript / Analysis · N segmented control, transcript "follows playback" (timestamps, click a line to seek, coach lines in blue), analysis cards (first full, rest compact).
- ☐ Desktop: sidebar + 300 px session list + detail with player, transcript left, analysis right ("All 5").

### Progress
- ☐ "Progress · N sessions · N days to go"; desktop stat tiles (13/16 LPs covered, ✓ strong hire, ● not inclined, hours practised).
- ☐ LP × session heatmap (last 8 sessions + NOW column).
- ☐ Weakest LPs (gold panel; name, why, **Drill**).
- ☐ Readiness · now (stacked bar + 4 counts).
- ☐ Trend · average verdict per session (line, "↗ improving").
- ☐ Story usage (bars; over-used in gold; "1 over-used").

### Settings
- ☐ Interview: interview date (+ "19 d" pill), loop size ("5 interviewers · 1 bar raiser").
- ☐ Gemini Live: API key (password, "Stored only in this browser"), live model, interviewer voice list with preview (Dana · "Even, unhurried · British", Priya, Tomasz, Marcus, Elena), **Test · say hello**, status line.
- ☐ Pause before my turn ends: slider 1 s (sharper) – 4 s (calmer), default 2.5 s, explanation.
- ☐ System instruction: mono editor, Reset, "Sent … on every session, after your files", saved on blur.
- ☐ Appearance: Light / Dark / System; voice visual and live layout (prototype tweaks).
- ☐ Library & data: Export everything ("Library, sessions, audio · 212 MB"), Import library (a Mock export, or markdown files), Back up everything (JSON), Restore a backup, Download recordings (N in IndexedDB), Run first-run setup again, Reset to sample data / **Delete all data** ("asks twice").
- ☐ "Mock 0.9 · everything stays on this device unless you export it."
- ☐ Session seed (prototype): number + ↻.

### First run (onboarding)
- ☐ Step 1 · drop: "Your 16 LPs are ready.", LP tiles, drop zone ("Drop files or a folder"), "Found in 4 files" summary (JD, Past loop notes, questions tagged by keyword), **Looks right** / "Skip — start with the sample library".
- ☐ Step 2 · say hello: API key, live model, voice, **Say hello · test the connection**; "Heard you · Earbuds · level ok · pause length set to 2.5 s from how you speak"; "Who interviews you · tap to hear"; "No key? Skip — the live screen runs a scripted demo".
- ☐ Step 3 · start: "That's it. Session 1 is short…", 16 LPs · N with a story, N questions, status; **Start session 1** / **Explore first** / Later.
- ☐ Progress dots (3), remembered forever (`onboarded`).

### App-level
- ☐ Splash while the database starts ("Loading the default question bank…", "Loading DuckDB-WASM…").
- ☐ Toasts (ink, top).
- ☐ Status badges: "DuckDB-WASM ✓" / "in-memory fallback"; Gemini "configured · model · voice" / "not configured — live screen runs the demo".
- ☐ Responsive: 390 × 844 phone layouts in the thumb zone; 1440 desktop layouts with sidebar.
