# Prep canvas

The canvas is a practice board for one question at a time, with the AI working beside you.

1. **A question.** It comes from your bank: questions tagged with an area, unseen first.
2. **Pick the area it tests.** A wrong pick turns red and the AI gives one hint; after two
   misses, **Show me** reveals it. Any area the question is tagged with counts. A secondary
   one counts too, and the AI names the primary.
3. **Answer out loud.** Press **Listen**. Your words appear as live captions, and every phrase
   is coloured as soon as the AI has heard it:
   - **green**: on track for a strong answer to this question and area,
   - **gold**: drifting (general talk, "we" instead of "I", detail that doesn't serve the point),
   - **red, struck through**: redo (wrong for the question, empty, or muddled).

   Hover a phrase for the AI's note. The bar under the answer says how it's going overall.
   **Finish answer** asks the AI for a one-line review; **Redo** clears the answer;
   **Next question** moves on.
4. **Whiteboard.** Draw with the pen, add notes, drag them by their top bar. The AI writes notes
   too (blue), for example an outline when you ask for one.
5. **Chat.** The AI chat is always at the side. Type to it, or just talk while no answer is
   running: what you say goes to the chat as a spoken message.

Open it from Practice → **Prep canvas**, or go to `#/canvas`.

## Who listens and judges

The canvas uses your [voice and model choice](/guide/providers):

| Setting | Hearing | Judging and chat |
|---|---|---|
| All Gemini (default) | Gemini Live input transcription (its replies are never played) | Gemini text model |
| Chrome speech to text | Chrome's recogniser (free) | the language model you picked |
| ElevenLabs speech to text | Scribe, cut on a short pause | the language model you picked |
| OpenAI-compatible model | as above | your endpoint (Ollama works) |

With no key the canvas still works: Chrome hears you and an offline judge marks phrases from
simple rules (first-person actions and numbers are on track, hedges and filler are redo).

## In a Google Meet call

The canvas runs as a **Meet add-on** on the main stage, so everyone in the call sees it. Open
**Activities → Mock** in Meet, then **Open the canvas for everyone**. Whoever opens it drives:
their browser hears the call and runs the AI, and the others see the same canvas live (they
can **Take over**). Inside Meet the canvas hears the call through the
[Meet Media API](/guide/meet#hear-the-call-through-the-meet-media-api): press **Sign in with
Google**, then **Listen**.

Meet keeps an add-on's storage apart from the app's, so the add-on starts with an empty library
and no key: load the AWS preset or [sync your vault](/guide/passphrase-sync), and paste your
Gemini key in the field at the top.

Setting the add-on up (once, for whoever hosts Mock) is described in
[`docs/canvas.md`](https://github.com/adeelahmad/Mock/blob/main/docs/canvas.md).
