# Google Meet interviewer

Mock can run the interview inside a Google Meet call. It joins as a participant, asks the
questions out loud, hears everyone in the call (a friend can sit in as a second interviewer),
and coaches as usual. The session still runs in the app, with your library, tools, cards and
History; the call is only where the audio goes.

## Run it

1. **Start the bridge** on the same computer as the app:

   ```sh
   mock bridge        # the Go binary; from a checkout: make bridge
   ```

   It prints a pairing code. It needs Chrome or Chromium (found on `PATH`, or
   `MOCK_BRIDGE_CHROMIUM=/path/to/chrome`). Options: `--headed` to watch the bot's browser,
   `--profile DIR` for a signed-in bot profile. Running the app from the binary on this
   computer? `mock --meet` serves the bridge too.
2. **Pair.** Practice → **Interview in Google Meet** → enter the code.
3. **Pick a meeting.** Paste a Meet link, or sign in with Google to create one. Creating needs
   an OAuth client id (`VITE_GOOGLE_CLIENT_ID` at build time, or typed in the sheet) with the
   Meet REST API enabled and the app's origin allowed.
4. **Invite Mock**, let it in if Meet asks, then **Start drill in Meet**. Needs a Gemini key.

If Mock drops out of the call mid-session (removed, the call ended, the bridge stopped), the
app ends the session and keeps what was said.

## How it works

The Gemini connection, session logic, tools, cards, report and recording all stay in the app
tab. The bridge (part of the [Go binary](/run/go-binary)) drives a Chromium that joins the call, sends
the call's audio to the app at 16 kHz and plays Mock's voice into the call as its microphone.
Its camera tile shows Mock's name, the phase, the area and the current question.

## Security

- The bridge listens on 127.0.0.1 only and accepts only the app's origins (localhost and
  GitHub Pages by default; `MOCK_BRIDGE_ORIGINS` to change), and only after the pairing code.
- It joins only `meet.google.com` links. One app tab at a time; when it closes, the bot leaves.
- The Gemini key and your Google token never reach the bridge.

## Limits

- Meet can change its join screen; the bot reports "Nobody let Mock in" or the denial text
  rather than hanging.
- Some workspaces block guests: use an open meeting from the app, or `--profile` with a
  signed-in bot account.
- For personal, user-invited use. Keep the app tab open: it is the control panel.
