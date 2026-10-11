# Voice and model

By default a session runs on **Gemini Live**: one connection that listens, thinks and speaks.
It is the most natural conversation, and it needs a Gemini key.

You can swap each part on its own:

| Part | Choices |
|---|---|
| Speech to text | Gemini · Chrome (free) · ElevenLabs Scribe |
| Language model | Gemini · any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp, vLLM, OpenAI, OpenRouter…) |
| Text to speech | Gemini · Chrome (free) · ElevenLabs |

Set the default in **Settings → Voice & model**. To change it for one session, open **More**
in the new-session sheet and pick there; Settings stays as it was.

With anything other than all-Gemini, the session runs turn by turn: you speak, Mock waits for
your pause (the same pause slider as Live), sends what you said to the model, and the voice
reads the reply out sentence by sentence. Questions, coaching, cards, the recording and History
work the same. Two differences: the interviewer can't be interrupted mid-sentence by voice (the
buttons still cut it off), and Chrome's voice isn't in the session recording.

## Free: Chrome speech and Ollama

1. Install [Ollama](https://ollama.com) and pull a model that supports tool calling, e.g.
   `ollama pull llama3.2` or `qwen2.5`.
2. Let the app call it from the browser. Start Ollama with the app's origin allowed, e.g.
   `OLLAMA_ORIGINS=https://adeelahmad.github.io ollama serve` (or `*` while you try it).
3. In Settings → Voice & model pick **Chrome** for speech to text and text to speech, and
   **OpenAI-compatible** for the model. Base URL `http://localhost:11434/v1`, model `llama3.2`.
4. Set **Context size** to the model's window. Mock trims the session prompt and the
   conversation to fit. Ollama's own window is set on the server (`OLLAMA_CONTEXT_LENGTH`).
5. **Test · say hello**, then start a session.

No Gemini key is needed for this setup. The same model also writes the coach cards and the
report. Chrome's recogniser is free but sends the audio to Google; its voices play on your
device.

## Other endpoints

Any server with `POST /v1/chat/completions` and `tools` works: put its base URL, an API key if
it needs one, and the model name. A model without tool calling still talks, but questions are
not pinned on screen.

## ElevenLabs

Paste an API key and a voice id from your ElevenLabs voice library. The voice model defaults
to `eleven_flash_v2_5` and speech to text to `scribe_v1`. ElevenLabs bills your account per
character; the [spend tracker](/guide/spend) does not include it.

## Cost

Chrome's engines and local models count as $0 in the spend tracker. A paid OpenAI-compatible
model is free in the tracker until you add a price row with its model id. Gemini parts are
priced as usual. Keys stay in your browser and, with [passphrase sync](/guide/passphrase-sync),
go only to your own devices.
