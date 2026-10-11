// Mock Meet bridge — the code that runs inside the Meet page, installed before Meet's own
// scripts (Page.addScriptToEvaluateOnNewDocument). It gives Meet a microphone and a camera that
// are really Mock: the mic is the interviewer's voice (Gemini's PCM scheduled into a MediaStream),
// the camera a canvas tile with who is asking and the pinned question. It also hooks
// RTCPeerConnection to hear every remote participant, mixes them, and hands 16 kHz PCM frames to
// Go through the `__mockBridgeSend` DevTools binding (JSON strings).
function installMeetBridge() {
  const W = window;
  if (W.__mockBridge) return;
  const emit = (m) => {
    try {
      if (W.__mockBridgeEmit) W.__mockBridgeEmit(m);
      else if (W.__mockBridgeSend) W.__mockBridgeSend(JSON.stringify(m));
    } catch {
    }
  };
  const OUT_RATE = 16e3;
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
  let ctx = null;
  let voice;
  let out;
  let mixer;
  let nextTime = 0;
  const playing = /* @__PURE__ */ new Set();
  const stats = { captured: 0, played: 0, remoteTracks: 0, gumCalls: 0 };
  const seen = /* @__PURE__ */ new Set();
  const keep = [];
  let canvas = null;
  let tile = { name: "Mock", mono: "M", role: "Interviewer", phase: "Ready", question: "Start the interview from the Mock app.", lp: "" };
  function resample(input, from, to) {
    if (from === to) return input;
    const ratio = from / to, n = Math.floor(input.length / ratio), o = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * ratio, i0 = Math.floor(x), i1 = Math.min(i0 + 1, input.length - 1), f = x - i0;
      o[i] = input[i0] * (1 - f) + input[i1] * f;
    }
    return o;
  }
  function toBase64(f) {
    const bytes = new Uint8Array(f.length * 2);
    const dv = new DataView(bytes.buffer);
    for (let i = 0; i < f.length; i++) {
      const v = Math.max(-1, Math.min(1, f[i]));
      dv.setInt16(i * 2, v < 0 ? v * 32768 : v * 32767, true);
    }
    let s = "";
    for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 32768)));
    return btoa(s);
  }
  function ensure() {
    if (ctx) return ctx;
    const c = new (W.AudioContext || W.webkitAudioContext)({ latencyHint: "interactive" });
    ctx = c;
    voice = c.createMediaStreamDestination();
    out = c.createGain();
    out.connect(voice);
    mixer = c.createGain();
    const silent = c.createGain();
    silent.gain.value = 0;
    silent.connect(c.destination);
    out.connect(silent);
    void c.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }))).then(() => {
      const tap = new AudioWorkletNode(c, "mock-tap");
      tap.port.onmessage = (e) => {
        stats.captured++;
        emit({ type: "pcm", data: toBase64(resample(e.data, c.sampleRate, OUT_RATE)) });
      };
      mixer.connect(tap);
      tap.connect(silent);
    });
    void c.resume().catch(() => void 0);
    setInterval(() => {
      if (c.state !== "running") void c.resume().catch(() => void 0);
    }, 1e3);
    return c;
  }
  function wrap(g, text, x, y, max, lh, lines) {
    const words = text.split(/\s+/);
    let line = "";
    let n = 0;
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (g.measureText(t).width > max && line) {
        g.fillText(n === lines - 1 ? line + "\u2026" : line, x, y + n * lh);
        line = w;
        if (++n >= lines) return;
      } else line = t;
    }
    if (line && n < lines) g.fillText(line, x, y + n * lh);
  }
  // The brand kit's robot (dark-surface colours), drawn in its own 56-unit grid centred on cx, cy.
  function robot(g, cx, cy, size) {
    const k = size / 60;
    g.save();
    g.translate(cx - 27.8 * k, cy - 55 * k);
    g.scale(k, k);
    const rr = (x, y, w, h, r, fill) => {
      g.beginPath();
      g.roundRect(x, y, w, h, r);
      g.fillStyle = fill;
      g.fill();
    };
    g.strokeStyle = "#8AB4F8";
    g.lineWidth = 4;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(28.05, 37.9);
    g.lineTo(28.05, 32.3);
    g.stroke();
    g.beginPath();
    g.arc(28.05, 29.7, 4.1, 0, Math.PI * 2);
    g.fillStyle = "#F9AB00";
    g.fill();
    rr(1.5, 51.1, 5.5, 15, 2.75, "#8AB4F8");
    rr(49.1, 51.1, 4.5, 15, 2.25, "#8AB4F8");
    rr(4, 37.9, 48.1, 46.2, 13, "#8AB4F8");
    rr(10, 44.3, 36.1, 30.8, 8.5, "#E8F0FE");
    rr(16.1, 51.7, 5.9, 7.9, 2.95, "#202124");
    rr(34.1, 51.7, 5.9, 7.9, 2.95, "#202124");
    g.strokeStyle = "#202124";
    g.lineWidth = 2.8;
    g.beginPath();
    g.moveTo(23.1, 66.5);
    g.quadraticCurveTo(28.05, 71, 33, 66.5);
    g.stroke();
    g.restore();
  }
  // Brand palette (brand kit v1.0): dark canvas, gold = interview, blue = coaching / Mock itself.
  const FONT = "'DM Sans', system-ui, sans-serif";
  function draw() {
    if (!canvas) return;
    const g = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    g.fillStyle = "#18191B";
    g.fillRect(0, 0, w, h);
    const speaking = playing.size > 0;
    const cx = 150, cy = h / 2, r = 72;
    const self = tile.mono === "M";
    if (speaking) {
      g.beginPath();
      g.arc(cx, cy, r + 10 + 4 * Math.sin(Date.now() / 120), 0, Math.PI * 2);
      g.fillStyle = self ? "rgba(138,180,248,.24)" : "rgba(249,171,0,.28)";
      g.fill();
    }
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = self ? "#292A2D" : "#F9AB00";
    g.fill();
    if (self) robot(g, cx, cy, 96);
    else {
      g.fillStyle = "#202124";
      g.font = "800 54px " + FONT;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(tile.mono.slice(0, 2), cx, cy + 2);
    }
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#E8EAED";
    g.font = "800 34px " + FONT;
    g.fillText(tile.name, 270, 120);
    g.fillStyle = "#9AA0A6";
    g.font = "600 20px " + FONT;
    g.fillText(tile.role + " \xB7 " + tile.phase + (tile.lp ? " \xB7 " + tile.lp : ""), 270, 152);
    g.fillStyle = "#E8EAED";
    g.font = "500 24px " + FONT;
    wrap(g, tile.question, 270, 210, w - 300, 32, 5);
    robot(g, 44, h - 33, 26);
    g.fillStyle = "#9AA0A6";
    g.font = "800 18px " + FONT;
    g.fillText("Mock", 64, h - 26);
    const mw = g.measureText("Mock").width;
    g.beginPath();
    g.arc(64 + mw + 5, h - 30, 3, 0, Math.PI * 2);
    g.fillStyle = "#F9AB00";
    g.fill();
  }
  function camera() {
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 540;
      draw();
      setInterval(draw, 100);
    }
    return canvas.captureStream(15).getVideoTracks()[0];
  }
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    md.getUserMedia = async (c) => {
      stats.gumCalls++;
      const tracks = [];
      if (c && c.audio) {
        ensure();
        tracks.push(voice.stream.getAudioTracks()[0].clone());
      }
      if (c && c.video) tracks.push(camera());
      return new MediaStream(tracks);
    };
  }
  function attach(track) {
    if (track.kind !== "audio" || seen.has(track.id)) return;
    seen.add(track.id);
    stats.remoteTracks++;
    const c = ensure();
    const stream = new MediaStream([track]);
    const el = new Audio();
    el.muted = true;
    el.srcObject = stream;
    void el.play().catch(() => void 0);
    keep.push(el);
    const src = c.createMediaStreamSource(stream);
    src.connect(mixer);
    track.addEventListener("ended", () => {
      try {
        src.disconnect();
      } catch {
      }
      seen.delete(track.id);
    });
  }
  const PC = W.RTCPeerConnection;
  if (PC) {
    const Hooked = class extends PC {
      constructor(...args) {
        super(...args);
        this.addEventListener("track", (e) => attach(e.track));
      }
    };
    W.RTCPeerConnection = Hooked;
    if (W.webkitRTCPeerConnection) W.webkitRTCPeerConnection = Hooked;
  }
  const api = {
    play(base64, rate) {
      const c = ensure();
      const bin = atob(base64);
      const n = bin.length >> 1;
      if (!n) return;
      const buf = c.createBuffer(1, n, rate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) {
        let v = bin.charCodeAt(i * 2) | bin.charCodeAt(i * 2 + 1) << 8;
        if (v >= 32768) v -= 65536;
        ch[i] = v / (v < 0 ? 32768 : 32767);
      }
      const s = c.createBufferSource();
      s.buffer = buf;
      s.connect(out);
      const at = Math.max(c.currentTime + 0.05, nextTime);
      s.start(at);
      nextTime = at + buf.duration;
      playing.add(s);
      stats.played++;
      s.onended = () => {
        playing.delete(s);
      };
    },
    flush() {
      for (const s of playing) {
        s.onended = null;
        try {
          s.stop();
        } catch {
        }
      }
      playing.clear();
      nextTime = 0;
    },
    tile(t) {
      tile = t;
      draw();
    },
    stats() {
      return { ...stats, speaking: playing.size > 0 };
    }
  };
  W.__mockBridge = api;
}
installMeetBridge();
