// Mock Meet bridge — the local server the app talks to. One WebSocket on 127.0.0.1, paired with a
// code printed at start, accepted only from the app's origins. It runs at most one bot: `join`
// starts it, meeting audio streams back to the app, interviewer audio and the tile go to the bot,
// and the bot leaves when the app says so or its tab disconnects.

import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { BRIDGE_VERSION, parseClientMsg, parseMeetLink, type BotStatus, type BridgeMsg } from '../src/meet/protocol.ts';
import type { BotLike } from './bot.ts';

export interface BotRequest { url: string; name: string; onStatus: (s: BotStatus, message?: string) => void; onPcm: (base64: string) => void }

export interface BridgeOptions {
  port: number;
  host?: string;
  token: string;
  /** Origins allowed to connect (the app's). */
  origins: string[];
  createBot: (r: BotRequest) => BotLike;
  /** Allow any http(s) URL, not only meet.google.com (tests use a fake Meet page). */
  anyUrl?: boolean;
  log?: (line: string) => void;
}

export interface Bridge { port: number; close(): Promise<void> }

export const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173', 'https://adeelahmad.github.io'];

/** "ABC-123"-style pairing code, easy to read off a terminal. */
export function pairingCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = () => A[Math.floor(Math.random() * A.length)];
  return Array.from({ length: 3 }, pick).join('') + '-' + Array.from({ length: 3 }, pick).join('');
}

export function startBridge(o: BridgeOptions): Promise<Bridge> {
  const log = o.log ?? (() => undefined);
  const wss = new WebSocketServer({
    port: o.port,
    host: o.host ?? '127.0.0.1',
    maxPayload: 4 * 1024 * 1024,
    verifyClient: (info: { origin: string; req: IncomingMessage }) => {
      const ok = !info.origin || o.origins.includes(info.origin);
      if (!ok) log('refused a connection from ' + info.origin);
      return ok;
    },
  });
  let app: WebSocket | null = null;
  let bot: BotLike | null = null;

  const send = (ws: WebSocket | null, m: BridgeMsg): void => { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
  const stopBot = async (): Promise<void> => { const b = bot; bot = null; if (b) await b.leave().catch(() => undefined); };

  wss.on('connection', (ws) => {
    let paired = false;
    const pairTimer = setTimeout(() => { if (!paired) ws.close(4001, 'No pairing code'); }, 5000);
    ws.on('message', (raw) => {
      const m = parseClientMsg(raw.toString());
      if (!m) return;
      if (!paired) {
        if (m.type !== 'hello') return;
        clearTimeout(pairTimer);
        if (m.token !== o.token) { send(ws, { type: 'error', message: 'Wrong pairing code' }); ws.close(4003, 'Wrong pairing code'); return; }
        if (m.version !== BRIDGE_VERSION) { send(ws, { type: 'error', message: 'Update the Meet bridge (protocol ' + m.version + ' ≠ ' + BRIDGE_VERSION + ')' }); ws.close(4004, 'Version mismatch'); return; }
        if (app && app.readyState === app.OPEN) { send(ws, { type: 'error', message: 'Another Mock tab is using the bridge' }); ws.close(4009, 'Busy'); return; }
        paired = true; app = ws;
        send(ws, { type: 'welcome', version: BRIDGE_VERSION });
        log('app connected');
        return;
      }
      switch (m.type) {
        case 'join': {
          const url = o.anyUrl && /^https?:\/\//.test(m.meetingUrl) ? m.meetingUrl : parseMeetLink(m.meetingUrl);
          if (!url) { send(ws, { type: 'status', status: 'error', message: 'Not a Google Meet link' }); return; }
          void (async () => {
            await stopBot();
            log('joining ' + url + ' as ' + m.botName);
            const b = o.createBot({
              url, name: m.botName,
              onStatus: (status, message) => { if (bot === b) { send(app, { type: 'status', status, message, meetingUrl: url }); log('bot: ' + status + (message ? ' · ' + message : '')); } },
              onPcm: (data) => { if (bot === b) send(app, { type: 'pcm', data }); },
            });
            bot = b;
            try { await b.start(); } catch (err) {
              if (bot === b) { send(app, { type: 'status', status: 'error', message: (err as Error).message.split('\n')[0] }); await stopBot(); }
            }
          })();
          return;
        }
        case 'play': bot?.play(m.data, m.rate); return;
        case 'flush': bot?.flush(); return;
        case 'tile': bot?.tile(m.tile); return;
        case 'leave': void stopBot().then(() => send(app, { type: 'status', status: 'left' })); return;
        default: return;
      }
    });
    ws.on('close', () => {
      clearTimeout(pairTimer);
      if (app === ws) { app = null; log('app disconnected · the bot leaves'); void stopBot(); }
    });
  });

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      const addr = wss.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : o.port,
        close: async () => { await stopBot(); for (const c of wss.clients) c.terminate(); await new Promise<void>((r) => wss.close(() => r())); },
      });
    });
  });
}
