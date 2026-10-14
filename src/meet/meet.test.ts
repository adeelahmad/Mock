import { describe, it, expect } from 'vitest';
import { parseBridgeMsg, parseClientMsg, parseMeetLink } from './protocol.ts';
import { createMeetSpace } from './google.ts';
import { MeetAudio, type LocalMix, type MediaSource } from './meet-audio.ts';
import { Speakers, connectConference, parseUpdate, resolveSpace, statsSections } from './media-api.ts';
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

class FakeLocal extends FakeAudio implements LocalMix { mixed: string[] = []; input: unknown = null; mixIn(b: string) { this.mixed.push(b); } setInput(s: MediaStream) { this.input = s; } }
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

describe('Meet Media API', () => {
  it('reads data channel updates', () => {
    expect(parseUpdate('{"resources":[{"id":1}],"deletedResources":[{"id":2}]}')).toEqual({ resources: [{ id: 1 }], deleted: [{ id: 2 }], response: null });
    expect(parseUpdate('nope')).toBeNull();
  });
  it('knows which CSRC is the bot', () => {
    const sp = new Speakers('Mock · Interviewer');
    sp.participants({ resources: [
      { id: 1, participant: { name: 'conferenceRecords/x/participants/a', participantId: 1, anonymousUser: { displayName: 'Mock · Interviewer' } } },
      { id: 2, participant: { name: 'conferenceRecords/x/participants/b', participantId: 2, signedInUser: { user: 'users/1', displayName: 'Adeel' } } },
    ] });
    sp.mediaEntries(JSON.stringify({ resources: [
      { id: 10, mediaEntry: { participantId: 1, participant: 'conferenceRecords/x/participants/a', audioCsrc: 111 } },
      { id: 11, mediaEntry: { participantId: 2, participant: 'conferenceRecords/x/participants/b', audioCsrc: 222 } },
    ] }));
    expect(sp.isBot(111)).toBe(true);
    expect(sp.isBot(222)).toBe(false);
    expect(sp.nameOf(222)).toBe('Adeel');
    expect(sp.isBot(42)).toBe(false);
    sp.mediaEntries({ deletedResources: [{ id: 10, mediaEntry: true }] });
    expect(sp.isBot(111)).toBe(false);
  });
  it('uploads only the allow-listed stats, snake_cased', () => {
    const out = statsSections([
      { id: 'IT01', type: 'inbound-rtp', packetsReceived: 5, jitter: 0.1, kind: 'audio' },
      { id: 'X', type: 'peer-connection', dataChannelsOpened: 4 },
    ], { 'inbound-rtp': { keys: ['packetsReceived', 'jitter'] } });
    expect(out).toEqual([{ id: 'IT01', inbound_rtp: { packets_received: 5, jitter: 0.1 } }]);
  });
  it('resolves the space and posts the offer', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith('/v2/spaces/abc-defg-hij')) return new Response(JSON.stringify({ name: 'spaces/SPACE1' }), { status: 200 });
      return new Response(JSON.stringify({ answer: 'v=0 answer' }), { status: 200 });
    }) as unknown as typeof fetch;
    const space = await resolveSpace('T', 'https://meet.google.com/abc-defg-hij', fetchFn);
    expect(space).toBe('spaces/SPACE1');
    expect(await connectConference('T', space, 'v=0 offer', fetchFn)).toBe('v=0 answer');
    expect(calls[1][0]).toBe('https://meet.googleapis.com/v2beta/spaces/SPACE1:connectActiveConference');
    expect(JSON.parse(String(calls[1][1]!.body))).toEqual({ offer: 'v=0 offer' });
  });
  it('falls back to the meeting code and explains refusals', async () => {
    const no = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    expect(await resolveSpace('T', 'abc-defg-hij', no)).toBe('spaces/abc-defg-hij');
    await expect(connectConference('T', 'spaces/x', 'o', no)).rejects.toThrow(/Developer Preview/);
  });
});

class FakeMedia implements MediaSource {
  onEnd: MediaSource['onEnd'] = null; closed = false; fail = false;
  async connect() { if (this.fail) throw new Error('Meet Media API: nope'); return {} as MediaStream; }
  close() { this.closed = true; }
}

describe('Meet audio through the Media API', () => {
  const pcm = int16ToBase64(new Int16Array(1600).fill(12000));
  it('hears the call through the local capture; the bot only speaks', async () => {
    const bridge = new FakeBridge(); const local = new FakeLocal(); const media = new FakeMedia();
    const notices: string[] = [];
    const a = new MeetAudio(bridge as unknown as MeetBridgeClient, local, { media, onNotice: (m) => notices.push(m) });
    const got: string[] = []; a.onPcm = (b) => got.push(b);
    await a.start();
    expect(a.viaMedia).toBe(true);
    expect(local.input).not.toBeNull();
    expect(bridge.onPcm).toBeNull();
    local.onPcm!(pcm);
    expect(got).toEqual([pcm]);
    a.play('BBBB', 24000);
    expect(bridge.played).toEqual([['BBBB', 24000]]);
    // Meet drops the Media API session: the bot's audio takes over.
    media.onEnd!('conference ended');
    expect(a.viaMedia).toBe(false);
    expect(notices[0]).toMatch(/through the bot/);
    local.onPcm!(pcm);
    expect(got.length).toBe(1);
    bridge.onPcm!(pcm);
    expect(got.length).toBe(2);
    a.close();
    expect(media.closed).toBe(true);
  });
  it('falls back to the bot when the Media API will not connect', async () => {
    const bridge = new FakeBridge(); const local = new FakeLocal(); const media = new FakeMedia(); media.fail = true;
    const notices: string[] = [];
    const a = new MeetAudio(bridge as unknown as MeetBridgeClient, local, { media, onNotice: (m) => notices.push(m) });
    await a.start();
    expect(a.viaMedia).toBe(false);
    expect(media.closed).toBe(true);
    expect(local.input).toBeNull();
    expect(notices[0]).toMatch(/nope · hearing the call through the bot/);
    expect(bridge.onPcm).not.toBeNull();
  });
});
