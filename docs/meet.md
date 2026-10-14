# Mock in Google Meet (M6)

Run a real mock interview inside a Google Meet call. The candidate signs in with Google in the
app, creates or picks a meeting, and invites Mock. An AI interviewer joins the call as a
participant, speaks with Gemini Live, uses tools to read the candidate's library, and coaches as
usual. A human mock interviewer can sit in the same call. The session lands in History like any
other.

## Shape

```
 Mock app (browser tab)                     Meet bridge (`mock bridge`, same computer) Google Meet
 ─────────────────────────                  ──────────────────────────────────       ───────────
 SessionController ── GeminiLiveTransport   ws://127.0.0.1:8788                      Chromium (chromedp)
        │                 │  AudioIO = MeetAudio ◄─ pcm 16 kHz ── bridge.go ◄── bot.go ◄── inpage.js: RTCPeerConnection hook
        │                 │                      ── play 24 kHz ─►          ──►       ──► inpage.js: getUserMedia = Mock's voice
   repo / History    Gemini Live (key stays here)  ── tile ───────►                    ──► canvas camera tile
```

The design kept the session in the app: the Gemini connection, controller, state machine, context
builder, tools, Flash cards, report, recording and History are unchanged. Only the audio endpoints
move. M3's `GeminiLiveTransport` already took an `AudioIO`, so the Meet path is a new `AudioIO`
(`src/meet/meet-audio.ts`) and a bridge that carries audio to and from the call. There is no
second Gemini client and no session logic in the bridge.

## Flow

1. **Bridge.** `mock bridge` (the Mock binary; `make bridge` from a checkout) on the candidate's
   computer prints a pairing code. `mock --meet` runs it alongside the app instead. In
   Practice → *Interview in Google Meet* the app connects to `ws://127.0.0.1:8788` with that code.
2. **Meeting.** Paste a Meet link or code, or *Sign in with Google · create a meeting*: Google
   Identity Services' token client (scope `meetings.space.created`, token kept in memory), then
   `POST https://meet.googleapis.com/v2/spaces` with `config.accessType = OPEN`.
3. **Invite.** The bridge launches Chromium, opens the meeting, types "Mock · Interviewer", and
   presses *Ask to join* / *Join now*. The sheet shows launching → joining → waiting to be let
   in → in the call.
4. **Interview.** *Start drill in Meet* (or *Full loop*) starts a normal session. The store sees
   Mock in the call and gives the transport a `MeetAudio`. Meeting audio goes to Gemini and
   Gemini's audio goes out through the bot's microphone. The live screen in the app keeps the
   controls (pause, redo, hint, end) and the cards.
5. **Results.** These are the same as an in-app session. The recording mixes the meeting audio
   and the interviewer. If Mock drops out of the call mid-session (removed, the call ended, or
   the bridge stopped), the app ends the session and keeps what was said.

## Pieces

| Piece | File | Notes |
|---|---|---|
| Wire protocol | `src/meet/protocol.ts` | JSON messages + validation, Meet link parser (mirrored in `internal/meet/protocol.go`) |
| Bridge client | `src/meet/bridge-client.ts` | pairing handshake, bot status, audio in/out, tile |
| Meet audio | `src/meet/meet-audio.ts` | `AudioIO` over the bridge; a silent `BrowserAudio` records and keeps timing |
| Meet link state | `src/meet/meet.ts` | the app's one bridge connection, saved address/code, tile mirroring |
| Google | `src/meet/google.ts` | GIS token client, create space |
| Media API | `src/meet/media-api.ts` | optional receive-only listener: offer, data channels, CSRC speaker filter, stats upload |
| Sheet | `src/screens/MeetSheet.tsx` | bridge → meeting → Mock in the call → start |
| Context tools | `src/live/context-tools.ts` | `get_story`, `find_questions`, `lp_history`, answered from the repo |
| Bridge | `internal/meet/bridge.go` | 127.0.0.1 only, origin allow-list, pairing code, one app tab, one bot |
| Bot | `internal/meet/bot.go` | Chromium over the DevTools protocol (chromedp), join loop with real mouse clicks, in-call monitor, page calls in order |
| Meet's page | `internal/meet/page.js` | every selector and Meet string in one file (role + accessible name, not classes) |
| In-page | `internal/meet/inpage.js` | `getUserMedia` override, `RTCPeerConnection` hook, AudioWorklet tap, tile |

### Audio in the call

- **Out (Mock → call).** `getUserMedia` returns a clone of a `MediaStreamAudioDestination` track,
  fed by a scheduler for Gemini's 24 kHz PCM. `flush` stops it on barge-in and pause.
- **Camera.** A 960×540 canvas `captureStream` shows the monogram, name, role, phase, LP and the
  pinned question. While Mock speaks, a ring pulses around the monogram. Coaching shows "Mock · Coach".
- **In (call → Mock).** A subclass of `RTCPeerConnection` catches every remote audio track. Each
  track also goes to a muted `<audio>` element, because Chrome only feeds remote WebRTC audio
  into Web Audio while an element plays it. The tracks are mixed and tapped by an AudioWorklet,
  then resampled to 16 kHz PCM16 and passed to Go through a DevTools binding (`Runtime.addBinding`). The bot never hears
  its own voice because it is not a remote track.
- **Levels** for the controller's speech hysteresis come from the RMS of the incoming frames.

### Hearing the call through the Meet Media API (optional)

The sheet's *Hear the call through* switch picks **The bot** (default, above) or **Meet Media
API**. The Media API is Google's official WebRTC access to a conference. It is receive-only and in
Developer Preview (the Cloud project, the OAuth principal and the participants must be enrolled),
so the bot still joins and speaks; only hearing moves.

- **Sign-in.** GIS token client with `meetings.conference.media.audio.readonly` and
  `meetings.space.readonly`, held in memory (about an hour).
- **Connect** (`src/meet/media-api.ts`), when a session starts: `GET v2/spaces/{code}` for the
  space name (falls back to `spaces/{code}`), an offer with exactly three `recvonly` audio
  m-lines then the `session-control`, `media-stats`, `media-entries` and `participants` data
  channels, `POST v2beta/{space}:connectActiveConference`, then wait for `STATE_JOINED` (the
  app may need admitting).
- **Audio.** The three virtual streams (loudest speakers) are mixed into one `MediaStream`, which
  the session's `BrowserAudio` captures like a mic (`setInput`): resampling, levels, recording and
  clips are unchanged.
- **Not hearing itself.** Each RTP packet's CSRC names the speaker. Participants and media
  entries map CSRCs to display names; a stream is silenced while its speaker is the bot's name.
- **Stats.** `media-stats` sends a config; the allow-listed `getStats()` fields are uploaded on
  its interval, as Meet requires.
- **Fallback.** No token, a refused or failed connect, or a later `STATE_DISCONNECTED`: a toast,
  and hearing switches to the bot's audio for the rest of the session. Closing sends `leave`.

### Tools

`new_question` is unchanged. The controller now takes extra tool handlers (`StartOptions.tools`).
The store passes the three lookups for every Gemini session, in the app or in Meet. They are
BLOCKING, so the model waits for the answer. They read the repository live, so an edit made a
minute ago is what the interviewer sees.

## Security

- The bridge binds 127.0.0.1. It accepts only the app's origins (localhost dev/preview and
  GitHub Pages by default; `MOCK_BRIDGE_ORIGINS` to change), and only after the pairing code
  (random per start, or `MOCK_BRIDGE_CODE`). One app tab at a time. When that tab disconnects,
  the bot leaves.
- `join` takes only `meet.google.com` links (`--any-url` exists for the tests' fake Meet page).
- The Gemini key and the Google token never reach the bridge.

## Limits and risks

| Risk | Handling |
|---|---|
| Meet changes its join screen | selectors by role and accessible name in `page.js`; the bot reports "Nobody let Mock in" / the denial text instead of hanging |
| Headless Chromium turned away | user agent without "HeadlessChrome"; `--headed`; `MOCK_BRIDGE_CHROMIUM` for installed Chrome |
| Guest needs admitting, or the domain blocks guests | OPEN spaces from the app; the sheet says "admit Mock"; `--profile DIR` for a signed-in bot |
| Automated participants and Google's terms | personal, user-invited use only. The Meet Media API (official WebRTC access) is receive-only and in developer preview: it can replace the input hook (*Hear the call through · Meet Media API*), but the bot still speaks |
| The app tab must stay open | the session lives there by design; the live screen is the control panel |
| Echo or double talk with a human interviewer | Meet's echo cancellation on their side; pause Mock from the live screen |

## Tests

- Unit: protocol validation, Meet links, space creation, `MeetAudio` routing and muting, camera
  tile, context tools, controller tool dispatch. Go (`internal/meet`): the bridge with a fake bot
  over a real socket (pairing, origin, link checks, one tab, leave on disconnect), and the real
  Chromium bot against the fake Meet page (runs when Chrome or Chromium is found).
- Playwright, against `bin/mock bridge`: the real bot joins a fake Meet page (`tests/fixtures/fake-meet.html`): it types its
  name, knocks, and is let in. It hears a 440 Hz participant through the `RTCPeerConnection`
  hook. Its microphone stays silent until it speaks, then a 1 kHz tone comes back through a real
  peer connection. A second test drives the sheet: pair, invite, in the call, remove.
- Playwright, Media API: the listener against a fake Meet in the same page (a second
  `RTCPeerConnection`): three audio m-lines first, the four data channels, admitted on
  `session-control`, a tone heard in the mixed stream, stats uploaded, `leave` on close. Unit:
  CSRC → bot mapping, stats filtering, space resolution, refusals, and `MeetAudio` falling back
  to the bot when the Media API fails or drops.
- Not covered automatically: a real Google Meet call (needs a Google account and a second
  participant). Do that by hand before relying on it.
