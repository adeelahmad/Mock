// Mock — hearing a Meet call through Google's Meet Media API (Developer Preview) instead of the
// bot's page. The app opens its own receive-only WebRTC connection to the conference: three
// virtual audio streams (the three loudest speakers), the session-control / media-stats /
// media-entries / participants data channels, and an SDP offer sent to
// spaces.connectActiveConference. The streams are mixed into one MediaStream that BrowserAudio
// takes as its "mic". The bot still joins the call to speak (the Media API cannot send), so a
// stream is silenced while its speaker (by RTP CSRC) is the bot itself. See docs/meet.md.

export const MEDIA_SCOPES = [
  'https://www.googleapis.com/auth/meetings.conference.media.audio.readonly',
  // spaces.get, to turn a meeting code into the space's resource name.
  'https://www.googleapis.com/auth/meetings.space.readonly',
];
const API = 'https://meet.googleapis.com';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A data channel message's resources and deleted resources (null when malformed). */
export function parseUpdate(raw: unknown): { resources: Obj[]; deleted: Obj[]; response: Obj | null } | null {
  let m: unknown = raw;
  if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch { return null; } }
  if (!isObj(m)) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);
  return { resources: list(m.resources), deleted: list(m.deletedResources), response: isObj(m.response) ? m.response : null };
}

/**
 * Who is speaking on each virtual stream: participants and media entries from their data
 * channels, joined by participant name (or key). `isBot(csrc)` is true when that CSRC belongs to a
 * participant whose display name is the bot's.
 */
export class Speakers {
  private names = new Map<number, { name: string; key: string; display: string }>();
  private entries = new Map<number, { participant: string; key: string; csrc: number }>();
  private botName: string;
  constructor(botName: string) { this.botName = botName.trim().toLowerCase(); }

  participants(raw: unknown): void {
    const u = parseUpdate(raw); if (!u) return;
    for (const r of u.resources) {
      const p = r.participant; if (!isObj(p) || typeof r.id !== 'number') continue;
      const user = [p.signedInUser, p.anonymousUser, p.phoneUser].find(isObj) as Obj | undefined;
      this.names.set(r.id, { name: String(p.name ?? ''), key: String(p.participantKey ?? ''), display: String(user?.displayName ?? '') });
    }
    for (const d of u.deleted) if (typeof d.id === 'number') this.names.delete(d.id);
  }

  mediaEntries(raw: unknown): void {
    const u = parseUpdate(raw); if (!u) return;
    for (const r of u.resources) {
      const e = r.mediaEntry; if (!isObj(e) || typeof r.id !== 'number') continue;
      this.entries.set(r.id, { participant: String(e.participant ?? ''), key: String(e.participantKey ?? ''), csrc: typeof e.audioCsrc === 'number' ? e.audioCsrc : -1 });
    }
    for (const d of u.deleted) if (typeof d.id === 'number') this.entries.delete(d.id);
  }

  /** The display name speaking with this CSRC ('' when unknown). */
  nameOf(csrc: number): string {
    for (const e of this.entries.values()) {
      if (e.csrc !== csrc) continue;
      for (const p of this.names.values()) if ((e.participant && p.name === e.participant) || (e.key && p.key === e.key)) return p.display;
    }
    return '';
  }

  isBot(csrc: number): boolean { return !!this.botName && this.nameOf(csrc).trim().toLowerCase() === this.botName; }
}

const snake = (s: string) => s.replace(/-/g, '_').replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

/** The media-stats upload: the allow-listed stat types and keys of a getStats() report. */
export function statsSections(reports: Iterable<Obj>, allowlist: Obj): Obj[] {
  const allow = new Map<string, string[]>();
  for (const [type, v] of Object.entries(allowlist)) {
    const keys = isObj(v) ? (v.keys ?? v.key) : null;
    if (Array.isArray(keys)) allow.set(snake(type), keys.map(String));
  }
  const out: Obj[] = [];
  for (const r of reports) {
    const type = snake(String(r.type ?? ''));
    const keys = allow.get(type);
    if (!keys) continue;
    const body: Obj = {};
    for (const k of keys) if (r[k] !== undefined) body[snake(k)] = r[k];
    out.push({ id: r.id, [type]: body });
  }
  return out;
}

/** spaces/{id} for a meeting link: spaces.get when it can, else the meeting code itself. */
export async function resolveSpace(token: string, meetingUrl: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const code = /([a-z]{3}-[a-z]{4}-[a-z]{3})/i.exec(meetingUrl)?.[1]?.toLowerCase();
  if (!code) throw new Error('Not a Google Meet link');
  try {
    const res = await fetchFn(API + '/v2/spaces/' + code, { headers: { Authorization: 'Bearer ' + token } });
    const body = await res.json().catch(() => ({})) as { name?: string };
    if (res.ok && body.name?.startsWith('spaces/')) return body.name;
    if (res.status === 401) throw new Error('Google sign-in expired · sign in again');
  } catch (err) { if (/expired/.test((err as Error).message)) throw err; }
  return 'spaces/' + code;
}

/** POST spaces/*:connectActiveConference with the offer; resolves with the SDP answer. */
export async function connectConference(token: string, space: string, offer: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(API + '/v2beta/' + space + ':connectActiveConference', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ offer }),
  });
  const body = await res.json().catch(() => ({})) as { answer?: string; error?: { message?: string; status?: string } };
  if (res.ok && body.answer) return body.answer;
  if (res.status === 401) throw new Error('Google sign-in expired · sign in again');
  const why = body.error?.message || 'error ' + res.status;
  if (res.status === 403) throw new Error('Meet Media API refused: ' + why + ' · is this Cloud project in the Developer Preview?');
  if (res.status === 404) throw new Error('Meet Media API: no active conference (' + why + ') · join the call first');
  throw new Error('Meet Media API: ' + why);
}

export interface MediaListenerOptions {
  token: string;
  meetingUrl: string;
  /** The bot's display name: its own voice is kept out of what Mock hears. */
  botName: string;
  fetchFn?: typeof fetch;
  makePc?: (cfg: RTCConfiguration) => RTCPeerConnection;
  /** How long to wait to be admitted (the Media API client is not let in automatically). */
  joinTimeoutMs?: number;
}

/**
 * One Media API session. `connect()` resolves with the mixed meeting audio once Meet has
 * admitted the client; `onEnd` fires if Meet drops it later (call ended, removed, unhealthy).
 */
export class MeetMediaListener {
  onEnd: ((reason: string) => void) | null = null;
  readonly speakers: Speakers;
  private o: MediaListenerOptions;
  private pc: RTCPeerConnection | null = null;
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private streams: { receiver: RTCRtpReceiver; gain: GainNode; el: HTMLAudioElement }[] = [];
  private control: RTCDataChannel | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private requestId = 1;
  private closed = false;
  private live = false;

  constructor(o: MediaListenerOptions) { this.o = o; this.speakers = new Speakers(o.botName); }

  async connect(): Promise<MediaStream> {
    const fetchFn = this.o.fetchFn ?? fetch.bind(globalThis);
    const pc = (this.o.makePc ?? ((c) => new RTCPeerConnection(c)))({ bundlePolicy: 'max-bundle', iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    this.pc = pc;
    const AC: typeof AudioContext = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    this.ctx = new AC();
    this.dest = this.ctx.createMediaStreamDestination();
    pc.ontrack = (e) => { if (e.track.kind === 'audio') this.addTrack(e.track, e.receiver); };

    // Meet wants the offer in this order: three audio m-lines, then the data channels.
    for (let i = 0; i < 3; i++) pc.addTransceiver('audio', { direction: 'recvonly' });
    const joined = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Meet Media API: not let in · admit the app in Meet')), this.o.joinTimeoutMs ?? 60_000);
      const control = pc.createDataChannel('session-control', { ordered: true });
      this.control = control;
      control.onmessage = (e) => {
        const u = parseUpdate(e.data);
        for (const r of u?.resources ?? []) {
          const st = isObj(r.sessionStatus) ? r.sessionStatus : null;
          if (!st) continue;
          if (st.connectionState === 'STATE_JOINED') { clearTimeout(timer); resolve(); }
          if (st.connectionState === 'STATE_DISCONNECTED') {
            const why = String(st.disconnectReason ?? 'disconnected').replace(/^REASON_/, '').toLowerCase().replace(/_/g, ' ');
            clearTimeout(timer);
            reject(new Error('Meet Media API: ' + why));
            const live = this.live;
            if (!this.closed) { this.close(); if (live) this.onEnd?.(why); }
          }
        }
      };
    });
    joined.catch(() => undefined); // awaited below; a failure before then must not go unhandled
    const stats = pc.createDataChannel('media-stats', { ordered: true });
    stats.onmessage = (e) => this.onStatsConfig(stats, e.data);
    pc.createDataChannel('media-entries', { ordered: true }).onmessage = (e) => this.speakers.mediaEntries(e.data);
    pc.createDataChannel('participants', { ordered: true }).onmessage = (e) => this.speakers.participants(e.data);

    try {
      await pc.setLocalDescription(await pc.createOffer());
      const space = await resolveSpace(this.o.token, this.o.meetingUrl, fetchFn);
      const answer = await connectConference(this.o.token, space, pc.localDescription?.sdp ?? '', fetchFn);
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      await joined;
    } catch (err) { this.close(); throw err; }
    this.live = true;
    void this.ctx.resume().catch(() => undefined);
    // Keep the bot out: a stream goes quiet while its current speaker is the bot.
    this.timers.push(setInterval(() => this.gate(), 50));
    return this.dest.stream;
  }

  private addTrack(track: MediaStreamTrack, receiver: RTCRtpReceiver): void {
    if (!this.ctx || !this.dest) return;
    const stream = new MediaStream([track]);
    // Chrome only feeds remote WebRTC audio into Web Audio while an element plays it.
    const el = document.createElement('audio');
    el.muted = true; el.srcObject = stream; void el.play().catch(() => undefined);
    const gain = this.ctx.createGain();
    this.ctx.createMediaStreamSource(stream).connect(gain);
    gain.connect(this.dest);
    this.streams.push({ receiver, gain, el });
  }

  private gate(): void {
    if (!this.ctx) return;
    for (const s of this.streams) {
      const sources = s.receiver.getContributingSources?.() ?? [];
      const now = sources.reduce<RTCRtpContributingSource | null>((a, b) => (!a || b.timestamp > a.timestamp ? b : a), null);
      const bot = now ? this.speakers.isBot(now.source) : false;
      s.gain.gain.setTargetAtTime(bot ? 0 : 1, this.ctx.currentTime, 0.01);
    }
  }

  private onStatsConfig(ch: RTCDataChannel, raw: unknown): void {
    const u = parseUpdate(raw);
    const cfg = u?.resources.map((r) => r.configuration).find(isObj);
    if (!cfg) return;
    const every = Number(cfg.uploadIntervalSeconds) || 0;
    const allow = isObj(cfg.allowlist) ? cfg.allowlist : {};
    if (every <= 0) return;
    this.timers.push(setInterval(() => {
      const pc = this.pc;
      if (!pc || ch.readyState !== 'open') return;
      void pc.getStats().then((report) => {
        const sections = statsSections(Array.from(report.values()) as Obj[], allow);
        if (ch.readyState === 'open') ch.send(JSON.stringify({ request: { requestId: this.requestId++, uploadMediaStats: { sections } } }));
      }).catch(() => undefined);
    }, every * 1000));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const s of this.streams) { s.el.srcObject = null; }
    this.streams = [];
    const pc = this.pc, ctx = this.ctx;
    this.pc = null; this.ctx = null;
    const teardown = () => { try { pc?.close(); } catch { /* ignore */ } void ctx?.close().catch(() => undefined); };
    // Say goodbye on session-control and give it a moment to go out before the connection closes.
    try {
      if (this.control?.readyState === 'open') { this.control.send(JSON.stringify({ request: { requestId: this.requestId++, leave: {} } })); setTimeout(teardown, 500); return; }
    } catch { /* closing anyway */ }
    teardown();
  }
}
