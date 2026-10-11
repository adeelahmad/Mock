# Mock in Google Meet — design (M6, after the MVP)

Status: design only. Build starts after M2 (storage) and M3 (Gemini Live) land, so this
reuses their transport, controller and context builder instead of duplicating them.

## Goal

Run a real mock interview inside a Google Meet call. The candidate signs in with Google in
the Mock app, creates or picks a meeting, and invites Mock. An AI interviewer joins the call
as a participant, speaks with Gemini Live, uses tools, and pulls its context (LPs, stories,
questions, files, previous reports) from the app. A human mock interviewer can sit in the
same call. Results land back in the app's History like any other session.

## Flow

1. **Sign in.** The app uses Google Identity Services (token client, no backend secret) with
   the scope `https://www.googleapis.com/auth/meetings.space.created`.
2. **Meeting.** "Create meeting" calls Meet REST `POST https://meet.googleapis.com/v2/spaces`
   with `config.accessType = OPEN` so the bot can join without being admitted. "Use a link"
   accepts an existing `meet.google.com/xxx-xxxx-xxx` URL (then the host admits the bot).
3. **Invite.** The app builds the session context with `buildContext()` and posts an invite
   to the Mock bridge: `{ meetingUri, botName, options (mode, focus, coaching, pause),
   systemInstruction, snapshot }`, where `snapshot` is the LPs, stories, questions, included
   files and recent reports the context tools answer from.
4. **Join.** The bridge launches Chromium (Playwright), opens the meeting, sets the display
   name and asks to join.
5. **Interview.** Meeting audio → Gemini Live; Gemini audio → the bot's microphone in the
   call. The session controller drives the state machine exactly as in the app.
6. **Results.** The bridge streams controller state, transcript, exchanges and analyses back
   to the app over SSE; the app writes them through the repo, mirrors the Live screen, and
   files the session in History when the call ends.

## Components

| Piece | Where | Notes |
|---|---|---|
| `meet/oauth.ts` | app | GIS token client, token kept in memory only |
| `meet/spaces.ts` | app | create space, parse/validate meeting links |
| `MeetSheet` | app | Sign in → Create or paste link → Invite Mock → live status / Leave |
| `meet/invite.ts` | app | POST invite, subscribe to `GET /sessions/:id/events` (SSE) |
| `context-tools.ts` | shared | tool declarations + handlers over the snapshot (below) |
| `meet-bridge/server.ts` | Node | `POST /invite`, `GET /sessions/:id/events`, `POST /sessions/:id/leave` |
| `meet-bridge/bot.ts` | Node | Playwright join, page ↔ Node audio via `exposeBinding` / `evaluate` |
| `meet-bridge/inpage.ts` | Meet page | `getUserMedia` override (AI voice + camera tile), `RTCPeerConnection` hook |
| `MeetAudioIO` | Node | the audio adapter M3's Gemini transport takes in place of the mic/speaker |

### Audio in the call

- **Out (AI → call).** `inpage.ts` replaces `navigator.mediaDevices.getUserMedia` before
  Meet loads. The audio track comes from an `AudioContext` destination fed by a 24 kHz PCM
  playback scheduler; `flush()` on barge-in and pause.
- **Camera tile.** The video track is a canvas `captureStream()` showing the interviewer
  monogram, phase (interviewer / answering / coaching) and the current question.
- **In (call → AI).** Wrap `RTCPeerConnection` to catch remote audio tracks (Meet sends the
  loudest few as separate tracks), mix them, downsample in an AudioWorklet to 16 kHz PCM16 and
  hand 100 ms chunks to Node. The bot's own voice never comes back in remote tracks.
- **Mic level** for the controller's VAD hysteresis comes from the same worklet (RMS).

### Reusing M3

M3's `GeminiLiveTransport` owns the WebSocket protocol (setup, VAD config, transcription,
barge-in, `new_question`, resumption, compression, GoAway). The Meet bridge only swaps the
audio endpoints: it passes a `MeetAudioIO` (`onPcm`, `play`, `flush`, `setMuted`,
`onLevel`) instead of the browser mic and speaker. If M3's transport hard-wires the
AudioWorklet mic, M6 starts by extracting that seam; no second Gemini client.

The `SessionController`, `session-machine`, `buildContext()` and analyzer run unchanged in
Node, with a `MemoryRepo` seeded from the snapshot.

### Tools and app context

`new_question` stays as is. The controller gains pluggable tool handlers
(`StartOptions.tools`) so the bridge can add read-only context tools answered from the
snapshot, keeping the system prompt short:

- `get_story(title_or_id)` → STAR, numbers, LP links
- `find_questions(lp, not_asked?)` → next questions for an LP, priority order
- `lp_history(lp)` → last verdicts and fixes for that LP from previous reports
- `get_file(name)` → an included prep file (or its summary)

Replies are immediate with `scheduling: SILENT`, matching the `NON_BLOCKING` default.

### Controls in the call

Voice commands work as in the app (the coach prompt's sentinels). Meet chat commands
`/pause`, `/resume`, `/next`, `/redo`, `/hint`, `/end` are read best-effort from the chat
panel; the app's MeetSheet has the same buttons, sent to the bridge.

## Where the bridge runs

- **Local first.** `npm run meet-bridge` on the candidate's machine, app talks to
  `http://localhost:8787`. Simplest, keeps the Gemini key local.
- **Hosted later.** Same server in a container (Cloud Run with Chromium). Then the app mints
  a Gemini ephemeral token per session instead of sending the key, and the bridge requires
  the Google ID token from step 1.

## Auth and keys

- Google OAuth token never leaves the app; the bridge does not need it to join an OPEN space.
- Gemini: the bridge uses `GEMINI_API_KEY` from its env, or an ephemeral token from the
  invite. The raw key is never put in the invite.
- The bot joins as a guest. Workspace domains that block external guests need the host to
  allow it, or the bridge runs with a signed-in bot profile (`--profile` dir).

## Risks

| Risk | Mitigation |
|---|---|
| Meet DOM changes break the join flow | selectors in one module, by role/aria-label; e2e smoke against a test meeting |
| Guest join blocked or needs admission | OPEN spaces from step 2; clear "waiting to be admitted" status in the sheet |
| Google bot policies / ToS for automated participants | personal, user-invited use only; document it; revisit Meet Media API when it supports sending audio |
| Meet Media API (official WebRTC access) is receive-only and in developer preview | not used for v1; could replace the `RTCPeerConnection` hook for input later |
| Echo / double talk with a human interviewer present | mixed remote audio is fine for Gemini VAD; human interviewer can `/pause` the AI |
| Latency page ↔ Node ↔ Gemini | 100 ms chunks, binary over `exposeBinding`, playback scheduled ahead |

## Milestone M6 (after M3)

1. Extract the audio seam from M3's transport; `MeetAudioIO` + fake for tests.
2. `context-tools.ts` with unit tests; controller tool handlers.
3. Bridge server + Playwright bot + in-page bridge; join a real meeting from the CLI.
4. App: OAuth, create space, MeetSheet, SSE results into the repo and History.
5. Tests: unit (tools, invite schema, SSE mapping), Playwright with a fake Meet page that
   exercises the `getUserMedia` / `RTCPeerConnection` hooks, one manual run in a real call.

## Open questions (defaults in brackets)

1. Local bridge first, hosted later? [yes]
2. Create OPEN meetings from the app, or only join links you paste? [both; create is default]
3. Bot display name? ["Mock · Interviewer"]
4. Allow a human interviewer to take over questions mid-session? [yes, via `/pause`]
