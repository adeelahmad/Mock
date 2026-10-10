// Mock — Gemini Live client (BidiGenerateContent over WebSocket). Mic in as 16 kHz PCM, audio out at 24 kHz, transcripts and tool calls as events.
export const VOICES = ['Aoede', 'Kore', 'Leda', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Orus'];
export const MODELS = ['gemini-2.0-flash-live-001', 'gemini-live-2.5-flash-preview', 'gemini-2.5-flash-preview-native-audio-dialog'];
const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };

// One-shot text generation (model answers). Same key; REST generateContent with a seed for reproducible variety.
export async function generateText({ apiKey, model, system, prompt, seed, temperature }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.5-flash'}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: temperature == null ? 0.9 : temperature } };
  if (seed) body.generationConfig.seed = +seed;
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
  return ((j.candidates || [])[0] && j.candidates[0].content && j.candidates[0].content.parts || []).map(p => p.text || '').join('');
}

export class GeminiLive {
  constructor(onEvent) { this.on = onEvent || (() => {}); this.ws = null; this.ac = null; this.playT = 0; this.sources = []; this.muted = false; this.level = 0; }
  async connect({ apiKey, model, voice, system, tools, seed }) {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
    this.ws = new WebSocket(url);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('Could not open the Live socket — check the API key and your network.')); setTimeout(() => rej(new Error('Timed out opening the Live socket.')), 10000); });
    this.ws.onmessage = async (ev) => { const txt = ev.data instanceof Blob ? await ev.data.text() : ev.data; let m; try { m = JSON.parse(txt); } catch { return; } this.handle(m); };
    this.ws.onclose = (e) => this.on('close', { code: e.code, reason: e.reason });
    this.ws.onerror = () => this.on('error', new Error('Live socket error'));
    const setup = { model: 'models/' + model, generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Aoede' } } } }, systemInstruction: { parts: [{ text: system || '' }] }, inputAudioTranscription: {}, outputAudioTranscription: {} };
    if (seed) setup.generationConfig.seed = +seed;
    if (tools && tools.length) setup.tools = [{ functionDeclarations: tools }];
    this.ws.send(JSON.stringify({ setup }));
    await new Promise((res, rej) => { this._setupRes = res; setTimeout(() => rej(new Error('The model did not acknowledge setup — try another model name.')), 10000); });
  }
  handle(m) {
    if (m.setupComplete) { this._setupRes && this._setupRes(); this.on('ready'); return; }
    if (m.toolCall) { this.on('toolCall', m.toolCall.functionCalls || []); return; }
    if (m.goAway) { this.on('error', new Error('Live session is about to close (server goAway).')); return; }
    const sc = m.serverContent; if (!sc) return;
    if (sc.interrupted) { this.stopPlayback(); this.on('interrupted'); }
    if (sc.inputTranscription && sc.inputTranscription.text) this.on('inputText', sc.inputTranscription.text);
    if (sc.outputTranscription && sc.outputTranscription.text) this.on('outputText', sc.outputTranscription.text);
    for (const p of (sc.modelTurn && sc.modelTurn.parts) || []) { if (p.inlineData && p.inlineData.data) this.playChunk(p.inlineData.data, p.inlineData.mimeType); else if (p.text) this.on('outputText', p.text); }
    if (sc.turnComplete) this.on('turnComplete');
  }
  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  sendText(text) { this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }); }
  sendToolResponse(responses) { this.send({ toolResponse: { functionResponses: responses } }); }
  async startMic() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.micCtx = new AC({ sampleRate: 16000 });
    const src = this.micCtx.createMediaStreamSource(this.stream);
    const proc = this.micCtx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      const f = e.inputBuffer.getChannelData(0); const pcm = new Int16Array(f.length); let sum = 0;
      for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; sum += s * s; }
      this.level = Math.sqrt(sum / f.length); this.on('level', this.level);
      if (!this.muted) this.send({ realtimeInput: { audio: { data: b64(pcm.buffer), mimeType: 'audio/pcm;rate=16000' } } });
    };
    src.connect(proc); proc.connect(this.micCtx.destination); this.src = src; this.proc = proc;
    try { this.chunks = []; this.rec = new MediaRecorder(this.stream); this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); }; this.rec.start(1000); } catch { this.rec = null; }
  }
  recordingBlob() { return new Promise((res) => { if (!this.rec) return res(null); if (this.rec.state === 'inactive') return res(this.chunks.length ? new Blob(this.chunks, { type: this.rec.mimeType }) : null); this.rec.onstop = () => res(this.chunks.length ? new Blob(this.chunks, { type: this.rec.mimeType }) : null); this.rec.stop(); }); }
  stopMic() { try { this.proc && this.proc.disconnect(); this.src && this.src.disconnect(); this.stream && this.stream.getTracks().forEach(t => t.stop()); this.micCtx && this.micCtx.close(); } catch {} }
  playChunk(data, mime) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.ac) { this.ac = new AC({ sampleRate: 24000 }); this.playT = 0; }
    if (this.ac.state === 'suspended') this.ac.resume();
    const rate = +((/rate=(\d+)/.exec(mime || '') || [])[1] || 24000);
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
    const buf = this.ac.createBuffer(1, pcm.length, rate); const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const node = this.ac.createBufferSource(); node.buffer = buf; node.connect(this.ac.destination);
    const start = Math.max(this.ac.currentTime + 0.03, this.playT); node.start(start); this.playT = start + buf.duration; this.sources.push(node);
    this.on('speaking', this.playT - this.ac.currentTime);
  }
  isSpeaking() { return !!this.ac && this.ac.currentTime < this.playT - 0.05; }
  stopPlayback() { this.sources.forEach(s => { try { s.stop(); } catch {} }); this.sources = []; this.playT = 0; }
  close() { this.stopMic(); this.stopPlayback(); try { this.ws && this.ws.close(); } catch {} this.ws = null; }
}
