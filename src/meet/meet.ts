// Mock — the app's one link to Google Meet: the bridge connection (address and pairing code
// remembered on this device), the bot's status, and the camera tile mirrored from the live
// session. The store asks `meet.inCall()` when a session starts and, if so, runs it in the call.
// `listen` picks how the call is heard: through the bot (default) or the Meet Media API, whose
// Google token lives in memory only.

import { useSyncExternalStore } from 'react';
import { MeetBridgeClient, type BridgeState } from './bridge-client.ts';
import { DEFAULT_BOT_NAME, DEFAULT_BRIDGE_URL, type Tile } from './protocol.ts';
import type { SessionState } from '../domain/session-machine.ts';
import { MeetMediaListener } from './media-api.ts';

export type Listen = 'bot' | 'media';

const KEY = 'mock.meet';
interface Saved { url: string; code: string; clientId: string; listen: Listen }
function load(): Saved {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return { url: v.url || DEFAULT_BRIDGE_URL, code: v.code || '', clientId: v.clientId || '', listen: v.listen === 'media' ? 'media' : 'bot' }; } catch { return { url: DEFAULT_BRIDGE_URL, code: '', clientId: '', listen: 'bot' }; }
}
function save(v: Saved): void { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } }

const PHASE: Record<string, string> = { connecting: 'Joining…', interviewer: 'Asking', answering: 'Listening', thinking: 'Listening', coaching: 'Coaching', ended: 'Recap', idle: 'Ready' };

/** What the bot's camera shows for a session state. */
export function tileFor(s: SessionState | null): Tile {
  if (!s) return { name: 'Mock', mono: 'M', role: 'Interviewer', phase: 'Ready', question: 'Start the interview from the Mock app.', lp: '' };
  const coaching = s.phase === 'coaching' || s.pausedFrom === 'coaching';
  return {
    name: coaching ? 'Mock' : s.interviewer.name,
    mono: coaching ? 'M' : s.interviewer.mono,
    role: coaching ? 'Coach' : s.interviewer.role,
    phase: s.pausedFrom ? 'Paused' : s.reconnecting ? 'Reconnecting…' : PHASE[s.phase] ?? s.phase,
    question: s.qText,
    lp: s.lpName,
  };
}

export class MeetLink {
  readonly client: MeetBridgeClient;
  saved: Saved = load();
  private lastTile = '';
  private botName = DEFAULT_BOT_NAME;
  /** Google token for the Media API (memory only) and when it stops working. */
  private mediaToken: { token: string; until: number } | null = null;

  constructor(client = new MeetBridgeClient()) { this.client = client; }

  get state(): BridgeState { return this.client.state; }
  subscribe = (l: () => void): (() => void) => this.client.subscribe(() => l());
  inCall(): boolean { return this.client.inCall(); }

  async connect(url: string, code: string): Promise<void> {
    this.saved = { ...this.saved, url: url.trim(), code: code.trim() };
    save(this.saved);
    await this.client.connect(this.saved.url, this.saved.code);
    this.lastTile = '';
  }
  setClientId(clientId: string): void { this.saved = { ...this.saved, clientId: clientId.trim() }; save(this.saved); }
  setListen(listen: Listen): void { this.saved = { ...this.saved, listen }; save(this.saved); }
  setMediaToken(token: string, now = Date.now()): void { this.mediaToken = { token, until: now + 55 * 60_000 }; }
  hasMediaToken(now = Date.now()): boolean { return !!this.mediaToken && this.mediaToken.until > now; }
  invite(meetingUrl: string, botName = DEFAULT_BOT_NAME): void { this.lastTile = ''; this.botName = botName; this.client.join(meetingUrl, botName); }

  /** A Media API session for the current call, when that is how the call is heard (null: the bot). */
  mediaListener(now = Date.now()): MeetMediaListener | null {
    if (this.saved.listen !== 'media' || !this.client.state.meetingUrl) return null;
    if (!this.hasMediaToken(now)) throw new Error('Sign in with Google again for the Meet Media API');
    return new MeetMediaListener({ token: this.mediaToken!.token, meetingUrl: this.client.state.meetingUrl, botName: this.botName });
  }
  /** A Media API listener for any call (the canvas): `botName` '' when no bot is in it. Null without a fresh token. */
  mediaListenerFor(meetingUrl: string, botName = '', now = Date.now()): MeetMediaListener | null {
    if (!this.hasMediaToken(now)) return null;
    return new MeetMediaListener({ token: this.mediaToken!.token, meetingUrl, botName });
  }
  /** The call Mock's bot is in, if any. */
  get meetingUrl(): string { return this.client.state.meetingUrl; }
  leave(): void { this.client.leave(); }
  disconnect(): void { this.client.close(); }

  /** Sends the tile when what it shows changed. */
  mirror(s: SessionState | null): void {
    if (!this.client.state.connected) return;
    const t = tileFor(s);
    const k = JSON.stringify(t);
    if (k === this.lastTile) return;
    this.lastTile = k;
    this.client.tile(t);
  }
}

export const meet = new MeetLink();

export function useMeet(): BridgeState {
  return useSyncExternalStore(meet.subscribe, () => meet.state, () => meet.state);
}
