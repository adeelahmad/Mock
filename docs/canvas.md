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

## The Meet add-on

The add-on uses the [Meet Add-ons SDK](https://developers.google.com/meet/add-ons/guides/overview).
The SDK is Google's hosted script (`https://www.gstatic.com/meetjs/addons/1.1.0/meet.addons.js`),
loaded only inside Meet; its licence is Google's terms of service, so it is not bundled. The npm
package `@googleworkspace/meet-addons` is a dev dependency for its types only.

- **Side panel** (`?addon=side`): one button, *Open the canvas for everyone*, which calls
  `startActivity({ mainStageUrl })`.
- **Main stage** (`?addon=stage`, `#/canvas`): the canvas without the app's chrome. The frame
  opened by `START_ACTIVITY` or `OPEN_ADDON` drives; frames opened by `JOIN_ACTIVITY` watch and
  can take over. The driver broadcasts the whole `CanvasState` through the co-doing client,
  throttled to one update per 250 ms and trimmed to 60 KB (oldest strokes, then chat, go first).
- **Hearing** in Meet goes through the Meet Media API listener from `meet/media-api.ts` (needs
  a Google sign-in with the Media API scopes and a Developer Preview project). The meeting code
  comes from `getMeetingInfo()`; with no bot in the call, nothing is filtered out by speaker.

Meet partitions the iframe's storage, so the add-on has its own library, keys and settings.

### Deploying the add-on

1. A Google Cloud project with the **Google Workspace Add-ons API** and **Google Workspace
   Marketplace SDK** enabled (and the Meet REST API, plus Media API Developer Preview enrolment,
   for hearing the call). Note its **project number**.
2. Host the app over HTTPS: GitHub Pages (`/app/`) or your own `mock` binary.
3. Create a deployment file, replacing `HOST` and `NUMBER`:

   ```json
   {
     "addOns": {
       "common": { "name": "Mock", "logoUrl": "https://HOST/app/icons/icon-192.png" },
       "meet": {
         "web": {
           "sidePanelUri": "https://HOST/app/?addon=side&project=NUMBER",
           "addOnOrigins": ["https://HOST"],
           "supportsCollaboration": true,
           "supportsScreenSharing": false
         }
       }
     }
   }
   ```

4. `gcloud workspace-add-ons deployments create mock --deployment-file=deployment.json`, then
   `gcloud workspace-add-ons deployments install mock` to test it in your own account.
5. In a call: **Activities → Mock → Open the canvas for everyone**.

The project number can also be built in with `VITE_MEET_CLOUD_PROJECT` instead of the URL.
Field names follow Google's add-on deployment docs as of October 2026; check them there if a
deployment is rejected.

## Testing

- `src/domain/canvas.test.ts`, `src/canvas/canvas.test.ts`: rules, judge and chat with a fake
  model, captions, both ears, add-on URL parsing and share throttling.
- `tests/e2e/canvas.spec.ts`: the whole flow with a stand-in Chrome recogniser, offline and with
  an OpenAI-compatible model answered by `page.route`.
- Inside a real Meet call the add-on is tested by hand (the SDK only runs in Meet).
