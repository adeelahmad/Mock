import { describe, it, expect } from 'vitest';
import { parseBridgeMsg, parseClientMsg, parseMeetLink } from './protocol.ts';
import { createMeetSpace } from './google.ts';
import { MeetAudio, type LocalMix } from './meet-audio.ts';
import { MeetBridgeClient } from './bridge-client.ts';
import { tileFor } from './meet.ts';
import { FakeAudio } from '../live/testing.ts';
import { initialState } from '../domain/session-machine.ts';
import { int16ToBase64 } from '../live/pcm.ts';

describe('Meet links', () => {
  it('accepts full links, bare links and codes; rejects anything else', () => {
    expect(parseMeetLink('https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
    expect(parseMeetLink(' meet.google.com/ABC-DEFG-HIJ?authuser=1 ')).toBe('https://meet.google.com/abc-defg-hij');
    expect(parseMeetLink('abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
    expect(parseMeetLink('https://evil.example/abc-defg-hij')).toBeNull();
    expect(parseMeetLink('https://meet.google.com.evil.example/abc-defg-hij')).toBeNull();
    expect(parseMeetLink('abc-defg')).toBeNull();
  });
});

describe('bridge protocol', () => {
  it('validates client messages', () => {
    expect(parseClientMsg('{"type":"hello","token":"ABC-123","version":1}')).toEqual({ type: 'hello', token: 'ABC-123', version: 1 });
    expect(parseClientMsg({ type: 'play', data: 'AAAA', rate: 24000 })).toEqual({ type: 'play', data: 'AAAA', rate: 24000 });
    expect(parseClientMsg({ type: 'play', data: 'AAAA', rate: 2 })).toBeNull();
    expect(parseClientMsg({ type: 'tile', tile: { name: 'Dana', mono: 'DW', role: 'Bar Raiser', phase: 'Asking', question: 'Q', lp: 'Ownership' } })?.type).toBe('tile');
    expect(parseClientMsg({ type: 'tile', tile: { name: 'Dana' } })).toBeNull();
    expect(parseClientMsg('not json')).toBeNull();
    expect(parseClientMsg({ type: 'rm -rf' })).toBeNull();
  });
  it('validates bridge messages', () => {
    expect(parseBridgeMsg('{"type":"status","status":"in_call","meetingUrl":"https://meet.google.com/abc-defg-hij"}')).toEqual({ type: 'status', status: 'in_call', meetingUrl: 'https://meet.google.com/abc-defg-hij' });
    expect(parseBridgeMsg({ type: 'status', status: 'dancing' })).toBeNull();
    expect(parseBridgeMsg({ type: 'pcm', data: 'AAAA' })).toEqual({ type: 'pcm', data: 'AAAA' });
  });
});

describe('creating a Meet space', () => {
  it('posts an OPEN space with the bearer token', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ name: 'spaces/x', meetingUri: 'https://meet.google.com/abc-defg-hij', meetingCode: 'abc-defg-hij' }), { status: 200 }); }) as unknown as typeof fetch;
    const s = await createMeetSpace('TOKEN', fetchFn);
    expect(s.meetingUri).toBe('https://meet.google.com/abc-defg-hij');
    expect(seen!.url).toBe('https://meet.googleapis.com/v2/spaces');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(String(seen!.init.body))).toEqual({ config: { accessType: 'OPEN' } });
  });
  it('explains an expired sign-in', async () => {
    const fetchFn = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(createMeetSpace('T', fetchFn)).rejects.toThrow(/expired/);
  });
});

class FakeLocal extends FakeAudio implements LocalMix { mixed: string[] = []; mixIn(b: string) { this.mixed.push(b); } }
class FakeBridge {
  played: [string, number][] = []; flushes = 0; onPcm: ((b: string) => void) | null = null; calls = true;
  inCall() { return this.calls; } play(d: string, r: number) { this.played.push([d, r]); } flush() { this.flushes++; }
}

describe('Meet audio', () => {
  const loud = int16ToBase64(new Int16Array(1600).fill(12000));
  it('meeting audio goes to Gemini and the recording; interviewer audio to the call and the recording', async () => {
    const bridge = new FakeBridge(); const local = new FakeLocal();
    const a = new MeetAudio(bridge as unknown as MeetBridgeClient, local);
    const pcm: string[] = []; const levels: number[] = [];
    a.onPcm = (b) => pcm.push(b); a.onLevel = (v) => levels.push(v);
    await a.start();
    expect(local.started).toBe(true);
    bridge.onPcm!(loud);
    expect(pcm).toEqual([loud]);
    expect(local.mixed).toEqual([loud]);
    expect(levels[0]).toBeGreaterThan(0.5);
    a.play('BBBB', 24000);
    expect(bridge.played).toEqual([['BBBB', 24000]]);
    expect(local.played).toEqual([['BBBB', 24000]]);
    a.setMuted(true);
    bridge.onPcm!(loud);
    expect(pcm.length).toBe(1);
    expect(levels[levels.length - 1]).toBe(0);
    a.stopPlayback();
    expect(bridge.flushes).toBe(1); expect(local.stops).toBe(1);
    a.close();
    expect(local.closed).toBe(true);
    expect(bridge.onPcm).toBeNull();
  });
  it('refuses to start before Mock is in the call', async () => {
    const bridge = new FakeBridge(); bridge.calls = false;
    await expect(new MeetAudio(bridge as unknown as MeetBridgeClient, new FakeLocal()).start()).rejects.toThrow(/not in the Meet call/);
  });
});

describe('camera tile', () => {
  it('shows the interviewer while asking and Mock while coaching', () => {
    const s = { ...initialState(0), phase: 'interviewer' as const, qText: 'Tell me about a time…', lpName: 'Ownership', interviewer: { n: 1, name: 'Dana Whitfield', role: 'Bar Raiser', mono: 'DW' } };
    expect(tileFor(s)).toMatchObject({ name: 'Dana Whitfield', mono: 'DW', phase: 'Asking', question: 'Tell me about a time…', lp: 'Ownership' });
    expect(tileFor({ ...s, phase: 'coaching' })).toMatchObject({ name: 'Mock', role: 'Coach', phase: 'Coaching' });
    expect(tileFor({ ...s, pausedFrom: 'answering' })).toMatchObject({ phase: 'Paused' });
  });
});
