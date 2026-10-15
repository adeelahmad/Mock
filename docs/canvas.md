# Prep canvas

A board for one question at a time: the candidate picks the area the question tests, then
answers out loud while the AI marks each phrase (on track / drifting / redo) as it is heard.
A whiteboard and the AI chat sit beside it. It runs in the app (`#/canvas`) and as a Google
Meet add-on on the main stage. User guide: `site/guide/canvas.md`.

## Shape

```
 mic ─────────────┐                                    ┌─► judge each phrase (coach.ts) ─► green / gold / red
                  ├─► Ear (canvas/ear.ts) ─ captions ──┤
 Meet Media API ──┘   Gemini Live input transcription  └─► talk outside an answer ─► chat (coach.ts) ─► notes on the whiteboard
 (meet/media-api.ts)  or a pipeline recogniser
                                     CanvasState (domain/canvas.ts) ─► Meet co-doing (canvas/addon.ts) ─► everyone in the call
```

| Piece | File | Notes |
|---|---|---|
| State and rules | `src/domain/canvas.ts` | pure: question deal, area pick (the Game's primary/secondary roles), phrase split, offline judge, summary, board, chat, share encoding |
| Hearing | `src/canvas/ear.ts` | `LiveEar`: Gemini Live used for `inputTranscription` only (told to say "Okay.", nothing played); `SpeechEar`: Chrome / ElevenLabs / Gemini recognisers from `speech/stt.ts`. `Captions` joins fragments and ends a stretch after 900 ms of quiet |
| AI | `src/canvas/coach.ts` | `judgePhrase` (JSON `{mark, note}`) and `chatReply` (with an `add_note` tool) on the provider's `ChatModel`; offline fallbacks for both; usage goes to the spend ledger |
| Screen | `src/screens/Canvas.tsx` | layout, listen/mute, judge and chat queues (in order), Meet sharing |
| Whiteboard | `src/components/Whiteboard.tsx` | SVG pen strokes in board units (1000 × 600) and draggable notes |
| Meet add-on | `src/canvas/addon.ts`, `src/screens/AddonSidePanel.tsx` | SDK loading, side panel → `startActivity`, main stage, co-doing state |

Speech is cut into phrases at sentence ends (and long sentences at commas), so marks land every
few seconds. Phrases are judged one at a time in order, each with the answer so far as context.
A phrase that is still being judged shows grey; words not yet cut into a phrase show as italic
captions.

## Saved to History

From **Listen** to **Stop & save** the sitting is one session (mode `canvas`, see
`src/canvas/session.ts`). Each answered question is an exchange whose verdict comes from its
marks (all on track: strong; mostly on track: inclined; drifting: not inclined; redo: no), a
redo keeps the earlier attempt, and the transcript holds the question, your phrases and the
AI's chat. The audio the canvas heard (the mic, or the Meet call) is recorded and saved with
it, so History plays it back. After saving, the bar offers the recording and a Markdown
transcript as downloads (inside Meet the add-on's storage is its own, so download them there).
A sitting where nothing was said is not kept.

## The whiteboard

Built to match the whiteboards people use in Meet (Miro and the like), in `src/domain/board.ts`
and `src/components/Whiteboard.tsx`: sticky notes in six colours, text, pen and highlighter in
six colours, an eraser, rectangles, ellipses, lines and arrows, templates (STAR answer, pros and
cons, timeline, story map), dot votes on notes, a timer everyone in the call sees, zoom
(50–200%), undo/redo (⌘Z, ⇧⌘Z), Delete for the selected item, and Save image (PNG). The board
stays between sittings in this browser's library.

In a Meet call **everyone edits the board**. Each item carries when it last changed and removed
items are remembered, so two people's boards merge item by item (newest change wins, removed
stays removed); a participant who has something the shared state lacks sends it again. The
question, answer and chat still follow whoever drives (Take over).

**Following:** anyone on the main stage can press **Bring everyone here**; everyone else then
follows their zoom and scroll on the board ("Following the host") until they scroll, zoom or
press Stop following, and can Follow again. Meet gives add-ons no participant names, so the
leader shows as "the host" (the driver) or "a participant".

Not matched, and why: live cursors and participant names (the Add-ons SDK gives no participant identity and
shared state is meant for occasional updates, not pointer streams), images and files (shared
state is limited to about 60 KB), comments, connectors that stick to shapes, and boards that
outlive the call for everyone (the board is kept per browser; there is no server board).

Small things: a REC clock in the header (paused while muted), an answer clock (gold past two
minutes, red past three), keys **L** listen/mute, **F** finish, **R** redo, **N** next, and on
the whiteboard **Undo** (your last stroke) and **Save image** (PNG).

## The Meet add-on

The add-on uses the [Meet Add-ons SDK](https://developers.google.com/meet/add-ons/guides/overview).
The SDK is Google's hosted script (`https://www.gstatic.com/meetjs/addons/1.1.0/meet.addons.js`),
loaded only inside Meet; its licence is Google's terms of service, so it is not bundled. The npm
package `@googleworkspace/meet-addons` is a dev dependency for its types only.

- **Side panel** (`?addon=side`): the canvas itself, sized for the panel, for practising alone.
  **Show everyone** calls `startActivity({ mainStageUrl })`; the panel then offers to end it.
- **Main stage** (`?addon=stage`, `#/canvas`): the canvas without the app's chrome. The frame
  opened by `START_ACTIVITY` or `OPEN_ADDON` drives; frames opened by `JOIN_ACTIVITY` watch and
  can take over. The driver broadcasts the whole `CanvasState` through the co-doing client,
  throttled to one update per 250 ms and trimmed to 60 KB (oldest strokes, then chat, go first).
- **Hearing** in Meet goes through the Meet Media API listener from `meet/media-api.ts` (needs
  a Google sign-in with the Media API scopes and a Developer Preview project). The meeting code
  comes from `getMeetingInfo()`; with no bot in the call, nothing is filtered out by speaker.

Meet partitions the iframe's storage, so the add-on has its own library, keys and settings.

### Deploying the add-on

It works like any Marketplace add-on (Miro, for example): it appears in Meet under **Meeting
tools → Add-ons**, opens in the side panel, and **Show everyone** asks Meet to start an
activity on the main stage. `supportsScreenSharing` lets people without the add-on follow the
main stage as a shared tab.

1. A Google Cloud project. The script enables the **Google Workspace add-ons API**, the
   **Google Workspace Marketplace SDK** and the Meet REST API. The Meet Media API Developer
   Preview is needed only to hear the call.
2. Host the app over HTTPS: GitHub Pages (`https://adeelahmad.github.io/Mock/app/`, the
   default) or your own `mock` binary.
3. `scripts/meet-addon.sh PROJECT_ID [APP_URL]` fills in `addon/deployment.json` (side panel
   URL with the project number, origins, logos), then creates or replaces the `mock`
   deployment and installs it for the account gcloud is signed in as. The same can be done in
   the Cloud console: Marketplace SDK → **HTTP deployments** → **Create new deployment** →
   paste the JSON → **Install**.
4. In a call: **Meeting tools → Add-ons → Mock**.

A Workspace whose admin blocks Marketplace apps blocks this one too: Admin console → Apps →
Google Workspace Marketplace apps → Settings, or allowlist the app. To list it for everyone,
publish it through the Marketplace SDK's **Store listing** (Google reviews it).

The project number can also be built in with `VITE_MEET_CLOUD_PROJECT` instead of the URL.

## Testing

- `src/domain/canvas.test.ts`, `src/canvas/canvas.test.ts`: rules, judge and chat with a fake
  model, captions, both ears, add-on URL parsing and share throttling.
- `tests/e2e/canvas.spec.ts`: the whole flow with a stand-in Chrome recogniser, offline and with
  an OpenAI-compatible model answered by `page.route`.
- Inside a real Meet call the add-on is tested by hand (the SDK only runs in Meet).
