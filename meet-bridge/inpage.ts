// Mock Meet bridge — the code that runs inside the Meet page, installed before Meet's own
// scripts. It gives Meet a microphone and a camera that are really Mock: the mic is the
// interviewer's voice (Gemini's PCM scheduled into a MediaStream), the camera a canvas tile
// with who is asking and the pinned question. It also hooks RTCPeerConnection to hear every
// remote participant, mixes them, and hands 16 kHz PCM frames to Node through the exposed
// `__mockBridgeEmit` binding.
//
// Playwright serialises this function with toString(), so it must be self-contained: no
// imports, no references outside its body. Types are erased by Node before serialisation.

export interface InpageApi {
  play(base64: string, rate: number): void;
  flush(): void;
  tile(t: { name: string; mono: string; role: string; phase: string; question: string; lp: string }): void;
  stats(): { captured: number; played: number; remoteTracks: number; gumCalls: number; speaking: boolean };
}

export function installMeetBridge(): void {
  const W = window as unknown as Record<string, any>;
  if (W.__mockBridge) return;
  const emit = (m: unknown): void => { try { W.__mockBridgeEmit?.(m); } catch { /* binding gone */ } };

  const OUT_RATE = 16000;
  const WORKLET = `
class MockTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; } }
    return true;
  }
}
registerProcessor('mock-tap', MockTap);`;

  let ctx: AudioContext | null = null;
  let voice: MediaStreamAudioDestinationNode;   // Mock's microphone in the call
  let out: GainNode;                            // interviewer audio → voice
  let mixer: GainNode;                          // remote participants → tap
  let nextTime = 0;
  const playing = new Set<AudioBufferSourceNode>();
  const stats = { captured: 0, played: 0, remoteTracks: 0, gumCalls: 0 };
  const seen = new Set<string>();
  const keep: HTMLAudioElement[] = [];
  let canvas: HTMLCanvasElement | null = null;
  let tile = { name: 'Mock', mono: 'M', role: 'Interviewer', phase: 'Ready', question: 'Start the interview from the Mock app.', lp: '' };

  function resample(input: Float32Array, from: number, to: number): Float32Array {
    if (from === to) return input;
    const ratio = from / to, n = Math.floor(input.length / ratio), o = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * ratio, i0 = Math.floor(x), i1 = Math.min(i0 + 1, input.length - 1), f = x - i0; o[i] = input[i0] * (1 - f) + input[i1] * f; }
    return o;
  }
  function toBase64(f: Float32Array): string {
    const bytes = new Uint8Array(f.length * 2);
    const dv = new DataView(bytes.buffer);
    for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); dv.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    return btoa(s);
  }

  function ensure(): AudioContext {
    if (ctx) return ctx;
    const c = new (W.AudioContext || W.webkitAudioContext)({ latencyHint: 'interactive' }) as AudioContext;
    ctx = c;
    voice = c.createMediaStreamDestination();
    out = c.createGain(); out.connect(voice);
    mixer = c.createGain();
    const silent = c.createGain(); silent.gain.value = 0; silent.connect(c.destination);
    // Keep the voice graph pulled even before Meet consumes the track.
    out.connect(silent);
    void c.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))).then(() => {
      const tap = new AudioWorkletNode(c, 'mock-tap');
      tap.port.onmessage = (e: MessageEvent<Float32Array>) => { stats.captured++; emit({ type: 'pcm', data: toBase64(resample(e.data, c.sampleRate, OUT_RATE)) }); };
      mixer.connect(tap); tap.connect(silent);
    });
    void c.resume().catch(() => undefined);
    setInterval(() => { if (c.state !== 'running') void c.resume().catch(() => undefined); }, 1000);
    return c;
  }

  // ---- the camera tile
  function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number, lines: number): void {
    const words = text.split(/\s+/); let line = ''; let n = 0;
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > max && line) { g.fillText(n === lines - 1 ? line + '…' : line, x, y + n * lh); line = w; if (++n >= lines) return; } else line = t;
    }
    if (line && n < lines) g.fillText(line, x, y + n * lh);
  }
  function draw(): void {
    if (!canvas) return;
    const g = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    g.fillStyle = '#16181d'; g.fillRect(0, 0, w, h);
    const speaking = playing.size > 0;
    const cx = 150, cy = h / 2, r = 72;
    if (speaking) { g.beginPath(); g.arc(cx, cy, r + 10 + 4 * Math.sin(Date.now() / 120), 0, Math.PI * 2); g.fillStyle = 'rgba(232,163,61,.28)'; g.fill(); }
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = '#e8a33d'; g.fill();
    g.fillStyle = '#16181d'; g.font = '800 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(tile.mono.slice(0, 2), cx, cy + 2);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#f4f1ea'; g.font = '800 34px system-ui, sans-serif'; g.fillText(tile.name, 270, 120);
    g.fillStyle = '#a7a39a'; g.font = '600 20px system-ui, sans-serif'; g.fillText(tile.role + ' · ' + tile.phase + (tile.lp ? ' · ' + tile.lp : ''), 270, 152);
    g.fillStyle = '#f4f1ea'; g.font = '500 24px system-ui, sans-serif'; wrap(g, tile.question, 270, 210, w - 300, 32, 5);
    g.fillStyle = '#6d6a63'; g.font = '700 16px system-ui, sans-serif'; g.fillText('MOCK', 30, h - 26);
  }
  function camera(): MediaStreamTrack {
    if (!canvas) {
      canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
      draw(); setInterval(draw, 100);
    }
    return (canvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(15).getVideoTracks()[0];
  }

  // ---- getUserMedia → Mock's voice and tile
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    md.getUserMedia = async (c?: MediaStreamConstraints): Promise<MediaStream> => {
      stats.gumCalls++;
      const tracks: MediaStreamTrack[] = [];
      if (c && c.audio) { ensure(); tracks.push(voice.stream.getAudioTracks()[0].clone()); }
      if (c && c.video) tracks.push(camera());
      return new MediaStream(tracks);
    };
  }

  // ---- RTCPeerConnection → hear the participants
  function attach(track: MediaStreamTrack): void {
    if (track.kind !== 'audio' || seen.has(track.id)) return;
    seen.add(track.id);
    stats.remoteTracks++;
    const c = ensure();
    const stream = new MediaStream([track]);
    // Chrome only feeds remote WebRTC audio into Web Audio while a media element plays it.
    const el = new Audio(); el.muted = true; el.srcObject = stream; void el.play().catch(() => undefined); keep.push(el);
    const src = c.createMediaStreamSource(stream);
    src.connect(mixer);
    track.addEventListener('ended', () => { try { src.disconnect(); } catch { /* ignore */ } seen.delete(track.id); });
  }
  const PC = W.RTCPeerConnection;
  if (PC) {
    const Hooked = class extends PC {
      constructor(...args: unknown[]) {
        super(...args);
        (this as unknown as RTCPeerConnection).addEventListener('track', (e: RTCTrackEvent) => attach(e.track));
      }
    };
    W.RTCPeerConnection = Hooked;
    if (W.webkitRTCPeerConnection) W.webkitRTCPeerConnection = Hooked;
  }

  const api: InpageApi = {
    play(base64, rate) {
      const c = ensure();
      const bin = atob(base64); const n = bin.length >> 1; if (!n) return;
      const buf = c.createBuffer(1, n, rate); const ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) { let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8); if (v >= 0x8000) v -= 0x10000; ch[i] = v / (v < 0 ? 0x8000 : 0x7fff); }
      const s = c.createBufferSource(); s.buffer = buf; s.connect(out);
      const at = Math.max(c.currentTime + 0.05, nextTime);
      s.start(at); nextTime = at + buf.duration;
      playing.add(s); stats.played++;
      s.onended = () => { playing.delete(s); };
    },
    flush() {
      for (const s of playing) { s.onended = null; try { s.stop(); } catch { /* not started */ } }
      playing.clear(); nextTime = 0;
    },
    tile(t) { tile = t; draw(); },
    stats() { return { ...stats, speaking: playing.size > 0 }; },
  };
  W.__mockBridge = api;
}
