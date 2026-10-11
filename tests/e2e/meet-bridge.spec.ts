// The Meet bridge end to end against a fake Meet page: the real bot joins (name, knock, let in),
// hears the participant through the RTCPeerConnection hook, and speaks through its microphone.
import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import WebSocket from 'ws';
import { startBridge } from '../../meet-bridge/server.ts';
import { MeetBot } from '../../meet-bridge/bot.ts';
import { MeetBridgeClient } from '../../src/meet/bridge-client.ts';
import type { SocketLike } from '../../src/live/gemini.ts';

const page = fs.readFileSync(new URL('../fixtures/fake-meet.html', import.meta.url));

/** Signal power at one frequency (Goertzel), normalised by the frame's energy. */
function tone(pcm: Int16Array, rate: number, hz: number): number {
  const k = 2 * Math.cos((2 * Math.PI * hz) / rate);
  let s1 = 0, s2 = 0, energy = 0;
  for (const v of pcm) { const x = v / 32768; const s = x + k * s1 - s2; s2 = s1; s1 = s; energy += x * x; }
  const power = s1 * s1 + s2 * s2 - k * s1 * s2;
  return energy ? power / (energy * pcm.length) : 0;
}
const decode = (b64: string) => { const b = Buffer.from(b64, 'base64'); return new Int16Array(b.buffer, b.byteOffset, b.length >> 1); };
function sine(hz: number, rate: number, ms: number): string {
  const n = Math.round((rate * ms) / 1000), out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 20000);
  return Buffer.from(out.buffer).toString('base64');
}

test('the bot joins, hears the call and speaks into it', async ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'one browser-launching run is enough');
  test.setTimeout(60_000);
  const server = http.createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end(page); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const site = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/meet';
  const statuses: string[] = [];
  const bridge = await startBridge({
    port: 0, token: 'T', origins: ['http://localhost:5173'], anyUrl: true,
    createBot: (r) => new MeetBot({ ...r, headless: true, executablePath: process.env.PW_CHROMIUM || process.env.MOCK_BRIDGE_CHROMIUM || undefined, joinTimeoutMs: 20_000 }),
  });
  const client = new MeetBridgeClient((u) => new WebSocket(u, { origin: 'http://localhost:5173' }) as unknown as SocketLike);
  try {
    await client.connect('ws://127.0.0.1:' + bridge.port, 'T');
    client.subscribe((s) => { if (statuses[statuses.length - 1] !== s.status) statuses.push(s.status); });
    const frames: Int16Array[] = [];
    client.onPcm = (b) => frames.push(decode(b));
    client.join(site, 'Mock · Interviewer');
    await expect.poll(() => client.state.status, { timeout: 30_000 }).toBe('in_call');
    expect(statuses).toEqual(expect.arrayContaining(['launching', 'joining', 'in_call']));

    // The participant's 440 Hz tone arrives as 16 kHz PCM.
    await expect.poll(() => frames.slice(-5).some((f) => tone(f, 16000, 440) > 0.2), { timeout: 15_000 }).toBe(true);

    // Silence on Mock's microphone until it speaks (the in-page bridge replaced the fake device).
    await new Promise((r) => setTimeout(r, 1500));
    expect(frames.some((f) => tone(f, 16000, 1000) > 0.05)).toBe(false);

    // Mock speaks: a 1 kHz tone through its microphone, looped back by the fake page.
    const before = frames.length;
    for (let i = 0; i < 20; i++) client.play(sine(1000, 24000, 100), 24000);
    await expect.poll(() => frames.slice(before).some((f) => tone(f, 16000, 1000) > 0.05), { timeout: 15_000 }).toBe(true);

    client.tile({ name: 'Dana Whitfield', mono: 'DW', role: 'Bar Raiser', phase: 'Asking', question: 'Tell me about a time you disagreed with your manager.', lp: 'Have Backbone' });
    client.leave();
    await expect.poll(() => client.state.status, { timeout: 10_000 }).toBe('left');
  } finally {
    client.close();
    await bridge.close();
    server.close();
  }
});

test('Practice → Interview in Google Meet pairs with the bridge and invites Mock', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const joined: string[] = [];
  const bridge = await startBridge({
    port: 0, token: 'ABC-123', origins: [new URL(info.project.use.baseURL!).origin],
    createBot: (r) => ({
      async start() { joined.push(r.url); r.onStatus('launching'); r.onStatus('waiting'); setTimeout(() => r.onStatus('in_call'), 300); },
      play() {}, flush() {}, tile() {}, async leave() { r.onStatus('left'); },
    }),
  });
  try {
    await page.goto('/?repo=sample#/practice');
    await page.waitForSelector('.splash', { state: 'detached', timeout: 30_000 }).catch(() => {});
    await page.getByRole('button', { name: 'Interview in Google Meet' }).click();
    const sheet = page.getByTestId('meet-sheet');
    await sheet.getByLabel('Bridge address').fill('ws://127.0.0.1:' + bridge.port);
    await sheet.getByLabel('Pairing code').fill('ABC-123');
    await page.getByRole('button', { name: 'Connect to the bridge' }).click();
    await expect(sheet.getByText(/Connected to ws:\/\/127\.0\.0\.1/)).toBeVisible();
    await sheet.getByLabel('Meet link or code').fill('abc-defg-hij');
    await page.getByRole('button', { name: 'Invite Mock to the meeting' }).click();
    await expect(page.getByTestId('meet-status')).toHaveText('In the call');
    expect(joined).toEqual(['https://meet.google.com/abc-defg-hij']);
    // Without a Gemini key the Meet session can't start, and the sheet says why.
    await expect(page.getByRole('button', { name: 'Start drill in Meet' })).toBeDisabled();
    await expect(page.getByText(/add a key in Settings/)).toBeVisible();
    await page.getByRole('button', { name: 'Remove from call' }).click();
    await expect(page.getByTestId('meet-status')).toHaveText('Left the call');
  } finally {
    await bridge.close();
  }
});
