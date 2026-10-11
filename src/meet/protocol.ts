// Mock — the wire protocol between the app and the Meet bridge (docs/meet.md). JSON over a
// WebSocket on localhost. The app keeps the session (Gemini Live, the controller, the library);
// the bridge only puts a bot in the Meet call and carries audio: meeting audio up as 16 kHz PCM,
// interviewer audio down as Gemini's 24 kHz PCM, plus the bot's camera tile. The bridge's Go
// mirror is internal/meet/protocol.go: keep the two in step.

export const BRIDGE_VERSION = 1;
export const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:8788';
export const DEFAULT_BOT_NAME = 'Mock · Interviewer';

/** Where the bot is: launching the browser, on the join screen, waiting to be let in, in the call, out of it. */
export type BotStatus = 'idle' | 'launching' | 'joining' | 'waiting' | 'in_call' | 'left' | 'error';
export const BOT_STATUSES: BotStatus[] = ['idle', 'launching', 'joining', 'waiting', 'in_call', 'left', 'error'];

/** What the bot's camera shows: who is asking, what phase, the pinned question. */
export interface Tile { name: string; mono: string; role: string; phase: string; question: string; lp: string }

export type ClientMsg =
  | { type: 'hello'; token: string; version: number }
  | { type: 'join'; meetingUrl: string; botName: string }
  | { type: 'play'; data: string; rate: number }
  | { type: 'flush' }
  | { type: 'tile'; tile: Tile }
  | { type: 'leave' };

export type BridgeMsg =
  | { type: 'welcome'; version: number }
  | { type: 'status'; status: BotStatus; message?: string; meetingUrl?: string }
  /** Meeting audio (every remote participant, mixed), base64 16-bit PCM at 16 kHz, ~128 ms. */
  | { type: 'pcm'; data: string }
  | { type: 'error'; message: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const s = (v: unknown, max = 4000): v is string => typeof v === 'string' && v.length <= max;
const MAX_AUDIO = 2_000_000;

function json(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function tileOf(v: unknown): Tile | null {
  if (!isObj(v)) return null;
  const t = { name: v.name, mono: v.mono, role: v.role, phase: v.phase, question: v.question, lp: v.lp };
  return Object.values(t).every((x) => s(x, 1000)) ? (t as Tile) : null;
}

/** A message from the app, validated (null when malformed). */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  const m = json(raw);
  if (!isObj(m)) return null;
  switch (m.type) {
    case 'hello': return s(m.token, 200) && typeof m.version === 'number' ? { type: 'hello', token: m.token, version: m.version } : null;
    case 'join': return s(m.meetingUrl, 500) && s(m.botName, 80) ? { type: 'join', meetingUrl: m.meetingUrl, botName: m.botName } : null;
    case 'play': return s(m.data, MAX_AUDIO) && typeof m.rate === 'number' && m.rate >= 8000 && m.rate <= 48000 ? { type: 'play', data: m.data, rate: m.rate } : null;
    case 'flush': return { type: 'flush' };
    case 'leave': return { type: 'leave' };
    case 'tile': { const t = tileOf(m.tile); return t ? { type: 'tile', tile: t } : null; }
    default: return null;
  }
}

/** A message from the bridge, validated (null when malformed). */
export function parseBridgeMsg(raw: unknown): BridgeMsg | null {
  const m = json(raw);
  if (!isObj(m)) return null;
  switch (m.type) {
    case 'welcome': return typeof m.version === 'number' ? { type: 'welcome', version: m.version } : null;
    case 'status': {
      if (!BOT_STATUSES.includes(m.status as BotStatus)) return null;
      const out: BridgeMsg = { type: 'status', status: m.status as BotStatus };
      if (s(m.message, 500)) out.message = m.message;
      if (s(m.meetingUrl, 500)) out.meetingUrl = m.meetingUrl;
      return out;
    }
    case 'pcm': return s(m.data, MAX_AUDIO) ? { type: 'pcm', data: m.data } : null;
    case 'error': return s(m.message, 500) ? { type: 'error', message: m.message } : null;
    default: return null;
  }
}

/**
 * A Google Meet link in canonical form (https://meet.google.com/abc-defg-hij), from a full URL,
 * a URL without the scheme, or a bare meeting code. Null for anything else.
 */
export function parseMeetLink(input: string): string | null {
  const t = input.trim();
  const code = /^(?:(?:https?:\/\/)?meet\.google\.com\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#].*)?$/i.exec(t)?.[1];
  return code ? 'https://meet.google.com/' + code.toLowerCase() : null;
}
