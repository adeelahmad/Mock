// The Meet bridge server with a fake bot, driven by the app's real bridge client over a real socket.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startBridge, type Bridge, type BotRequest } from '../../meet-bridge/server.ts';
import type { BotLike } from '../../meet-bridge/bot.ts';
import { MeetBridgeClient } from '../../src/meet/bridge-client.ts';
import type { SocketLike } from '../../src/live/gemini.ts';
import type { Tile } from '../../src/meet/protocol.ts';

const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
};

class FakeBot implements BotLike {
  static last: FakeBot | null = null;
  played: [string, number][] = []; tiles: Tile[] = []; flushes = 0; left = false;
  constructor(public r: BotRequest) { FakeBot.last = this; }
  async start() { this.r.onStatus('launching'); this.r.onStatus('joining'); this.r.onStatus('in_call'); }
  play(d: string, rate: number) { this.played.push([d, rate]); }
  flush() { this.flushes++; }
  tile(t: Tile) { this.tiles.push(t); }
  async leave() { this.left = true; }
}

const ORIGIN = 'http://localhost:5173';
const socket = (origin = ORIGIN) => (url: string) => new WebSocket(url, { origin }) as unknown as SocketLike;
let bridge: Bridge | null = null;
afterEach(async () => { await bridge?.close(); bridge = null; FakeBot.last = null; });

describe('Meet bridge', () => {
  it('pairs, joins, relays audio both ways and leaves when the app disconnects', async () => {
    bridge = await startBridge({ port: 0, token: 'ABC-123', origins: [ORIGIN], createBot: (r) => new FakeBot(r) });
    const c = new MeetBridgeClient(socket());
    await c.connect('ws://127.0.0.1:' + bridge.port, 'ABC-123');
    expect(c.state.connected).toBe(true);

    c.join('meet.google.com/abc-defg-hij', 'Mock · Interviewer');
    await until(() => c.inCall());
    expect(FakeBot.last!.r.url).toBe('https://meet.google.com/abc-defg-hij');
    expect(c.state.meetingUrl).toBe('https://meet.google.com/abc-defg-hij');

    const heard: string[] = [];
    c.onPcm = (b) => heard.push(b);
    FakeBot.last!.r.onPcm('MEETING');
    await until(() => heard.length === 1);
    expect(heard).toEqual(['MEETING']);

    c.play('VOICE', 24000); c.flush(); c.tile({ name: 'Dana', mono: 'DW', role: 'Bar Raiser', phase: 'Asking', question: 'Q', lp: 'Ownership' });
    await until(() => FakeBot.last!.tiles.length === 1);
    expect(FakeBot.last!.played).toEqual([['VOICE', 24000]]);
    expect(FakeBot.last!.flushes).toBe(1);

    const bot = FakeBot.last!;
    c.close();
    await until(() => bot.left);
  });

  it('refuses a wrong code, another origin, and links that are not Meet', async () => {
    bridge = await startBridge({ port: 0, token: 'ABC-123', origins: [ORIGIN], createBot: (r) => new FakeBot(r) });
    const url = 'ws://127.0.0.1:' + bridge.port;
    await expect(new MeetBridgeClient(socket()).connect(url, 'nope')).rejects.toThrow(/Wrong pairing code/);
    await expect(new MeetBridgeClient(socket('https://evil.example')).connect(url, 'ABC-123', 1500)).rejects.toThrow();
    const c = new MeetBridgeClient(socket());
    await c.connect(url, 'ABC-123');
    c.join('https://evil.example/abc-defg-hij', 'Mock');
    await until(() => c.state.status === 'error');
    expect(c.state.message).toMatch(/Not a Google Meet link/);
    expect(FakeBot.last).toBeNull();
    c.close();
  });

  it('lets only one app tab drive the bot', async () => {
    bridge = await startBridge({ port: 0, token: 'ABC-123', origins: [ORIGIN], createBot: (r) => new FakeBot(r) });
    const url = 'ws://127.0.0.1:' + bridge.port;
    const a = new MeetBridgeClient(socket());
    await a.connect(url, 'ABC-123');
    await expect(new MeetBridgeClient(socket()).connect(url, 'ABC-123')).rejects.toThrow(/Another Mock tab/);
    a.close();
  });
});
