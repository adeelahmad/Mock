// The Meet Media API listener against a fake Meet in the same page: a second RTCPeerConnection
// answers the offer (three audio m-lines, the data channels), admits the client on
// session-control, asks for stats on media-stats, and sends a tone on every virtual stream. The
// listener's mixed stream must carry it, stats must be uploaded, and closing must send leave.
import { test, expect } from '@playwright/test';

test('the Media API listener connects, hears the call, uploads stats and leaves', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one WebRTC run is enough');
  await page.goto('/');
  const out = await page.evaluate(async () => {
    const { MeetMediaListener } = await import('/src/meet/media-api.ts' as string);
    const log: { offer: string; url: string; got: Record<string, unknown[]> } = { offer: '', url: '', got: {} };
    const server = new RTCPeerConnection();
    const ac = new AudioContext();
    const osc = ac.createOscillator(); osc.frequency.value = 440;
    const toneDest = ac.createMediaStreamDestination(); osc.connect(toneDest); osc.start();
    server.ondatachannel = (e) => {
      const ch = e.channel;
      log.got[ch.label] = [];
      ch.onmessage = (m) => log.got[ch.label].push(JSON.parse(m.data));
      ch.onopen = () => {
        if (ch.label === 'session-control') setTimeout(() => ch.send(JSON.stringify({ resources: [{ sessionStatus: { connectionState: 'STATE_JOINED' } }] })), 200);
        if (ch.label === 'media-stats') ch.send(JSON.stringify({ resources: [{ configuration: { uploadIntervalSeconds: 1, allowlist: { 'inbound-rtp': { keys: ['packetsReceived', 'kind'] } } } }] }));
      };
    };
    const fetchFn = async (url: string, init?: RequestInit) => {
      if (!url.includes(':connectActiveConference')) return new Response('{}', { status: 404 });
      log.url = url;
      const offer = JSON.parse(String(init!.body)).offer as string;
      log.offer = offer;
      await server.setRemoteDescription({ type: 'offer', sdp: offer });
      for (const t of server.getTransceivers()) { t.direction = 'sendonly'; await t.sender.replaceTrack(toneDest.stream.getAudioTracks()[0]); }
      await server.setLocalDescription(await server.createAnswer());
      return new Response(JSON.stringify({ answer: server.localDescription!.sdp }), { status: 200 });
    };
    // Trickle ICE between the two in-page peers (real Meet answers with public candidates).
    const makePc = (cfg: RTCConfiguration) => {
      const pc = new RTCPeerConnection({ ...cfg, iceServers: [] });
      pc.onicecandidate = (e) => { if (e.candidate) void server.addIceCandidate(e.candidate).catch(() => undefined); };
      server.onicecandidate = (e) => { if (e.candidate) void pc.addIceCandidate(e.candidate).catch(() => undefined); };
      return pc;
    };
    const l = new MeetMediaListener({ token: 'T', meetingUrl: 'https://meet.google.com/abc-defg-hij', botName: 'Mock · Interviewer', fetchFn, makePc, joinTimeoutMs: 10_000 });
    l.onEnd = () => undefined;
    const stream: MediaStream = await l.connect();
    // Is the tone in the mixed stream?
    const probe = new AudioContext();
    const an = probe.createAnalyser(); an.fftSize = 2048;
    probe.createMediaStreamSource(stream).connect(an);
    let peak = 0;
    const buf = new Float32Array(an.fftSize);
    for (let i = 0; i < 40 && peak < 0.05; i++) { await new Promise((r) => setTimeout(r, 100)); an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); }
    await new Promise((r) => setTimeout(r, 1500));
    l.close();
    await new Promise((r) => setTimeout(r, 300));
    return { peak, url: log.url, audioLines: (log.offer.match(/^m=audio/gm) ?? []).length, firstLine: /^m=(\w+)/m.exec(log.offer)?.[1], channels: Object.keys(log.got).sort(), stats: log.got['media-stats'], control: log.got['session-control'] };
  });
  expect(out.url).toBe('https://meet.googleapis.com/v2beta/spaces/abc-defg-hij:connectActiveConference');
  expect(out.audioLines).toBe(3);
  expect(out.firstLine).toBe('audio');
  expect(out.channels).toEqual(['media-entries', 'media-stats', 'participants', 'session-control']);
  expect(out.peak).toBeGreaterThan(0.05);
  expect((out.stats as any[]).length).toBeGreaterThan(0);
  expect((out.stats as any[])[0].request.uploadMediaStats.sections.some((s: any) => s.inbound_rtp?.packets_received > 0)).toBe(true);
  expect(out.control).toEqual([{ request: { requestId: expect.any(Number), leave: {} } }]);
});
