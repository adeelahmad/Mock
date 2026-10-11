// Mock — the app's one link to Google Meet: the bridge connection (address and pairing code
// remembered on this device), the bot's status, and the camera tile mirrored from the live
// session. The store asks `meet.inCall()` when a session starts and, if so, runs it in the call.

import { useSyncExternalStore } from 'react';
import { MeetBridgeClient, type BridgeState } from './bridge-client.ts';
import { DEFAULT_BOT_NAME, DEFAULT_BRIDGE_URL, type Tile } from './protocol.ts';
import type { SessionState } from '../domain/session-machine.ts';

const KEY = 'mock.meet';
interface Saved { url: string; code: string; clientId: string }
function load(): Saved {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return { url: v.url || DEFAULT_BRIDGE_URL, code: v.code || '', clientId: v.clientId || '' }; } catch { return { url: DEFAULT_BRIDGE_URL, code: '', clientId: '' }; }
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
  invite(meetingUrl: string, botName = DEFAULT_BOT_NAME): void { this.lastTile = ''; this.client.join(meetingUrl, botName); }
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
