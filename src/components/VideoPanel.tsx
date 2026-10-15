// Mock — a video everyone on the canvas watches together: a YouTube link, a video file, an HLS
// stream (.m3u8, live or not; hls.js where the browser has no HLS) or an MJPEG camera stream.
// Play, pause and seeking (in the player or with the buttons) go out with the board, and each
// participant's player follows: jumps to the shared position and plays or pauses. Meet's
// add-on state carries no media, so each person's browser streams the video itself; a live
// camera or screen is not possible here (present it with Meet instead).

import { useEffect, useRef, useState } from 'react';
import { playVideo, setVideo, videoPosition, videoProblem, videoSource, type Board, type SharedVideo } from '../domain/board.ts';

/** Drift we let pass before jumping (seconds). */
const DRIFT_S = 1.5;
/** Player events right after we moved it are our own echo. */
const ECHO_MS = 900;
const YT = /^https:\/\/www\.youtube(-nocookie)?\.com$/;

export default function VideoPanel({ video, onChange, readOnly }: { video: SharedVideo; onChange: (f: (b: Board) => Board) => void; readOnly?: boolean }) {
  const src = videoSource(video.url);
  const file = useRef<HTMLVideoElement>(null);
  const yt = useRef<HTMLIFrameElement>(null);
  const ytTime = useRef(0);
  const ytState = useRef(-1);
  const applied = useRef(0);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState('');
  const el = src?.kind === 'file' || src?.kind === 'hls';
  /** A live stream has no shared position: everyone watches the live edge. */
  const isLive = () => src?.kind === 'mjpeg' || (el && file.current?.duration === Infinity);

  // HLS: native where the browser has it (Safari, newer Chrome), else hls.js.
  useEffect(() => {
    const v = file.current;
    if (src?.kind !== 'hls' || !v) return;
    setFailed('');
    if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = src.url; return; }
    let hls: { destroy(): void } | null = null, alive = true;
    void import('hls.js').then(({ default: Hls }) => {
      if (!alive) return;
      if (!Hls.isSupported()) { setFailed('This browser can’t play HLS.'); return; }
      const h = new Hls({ lowLatencyMode: true });
      h.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) setFailed('The stream stopped (' + d.details + ').'); });
      h.loadSource(src.url); h.attachMedia(v); hls = h;
    });
    return () => { alive = false; hls?.destroy(); };
  }, [src?.kind, src && 'url' in src ? src.url : '']);

  const localPos = (): number => (el ? file.current?.currentTime ?? 0 : ytTime.current);
  const send = (playing: boolean, pos = localPos()) => { if (!readOnly) onChange((b) => playVideo(b, playing, pos)); };
  const ytCmd = (func: string, args: unknown[] = []) => yt.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');

  // Follow the shared state.
  const apply = () => {
    const pos = videoPosition(video);
    applied.current = Date.now();
    if (el) {
      const v = file.current; if (!v) return;
      if (!isLive() && Math.abs(v.currentTime - pos) > DRIFT_S) v.currentTime = pos;
      if (video.playing && v.paused) v.play().then(() => setBlocked(false), () => setBlocked(true));
      if (!video.playing && !v.paused) v.pause();
    } else if (src?.kind === 'youtube') {
      if (Math.abs(ytTime.current - pos) > DRIFT_S) ytCmd('seekTo', [pos, true]);
      ytCmd(video.playing ? 'playVideo' : 'pauseVideo');
    }
  };
  const applyRef = useRef(apply); applyRef.current = apply;
  useEffect(() => { applyRef.current(); }, [video.t, video.url]);

  // YouTube tells us its time and state once we listen.
  useEffect(() => {
    if (src?.kind !== 'youtube') return;
    const onMsg = (e: MessageEvent) => {
      if (!YT.test(e.origin) || e.source !== yt.current?.contentWindow) return;
      let m: { event?: string; info?: { currentTime?: number; playerState?: number } | number };
      try { m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
      if (m.event === 'onReady') { applyRef.current(); return; }
      const info = typeof m.info === 'object' && m.info ? m.info : null;
      if (info?.currentTime != null) ytTime.current = info.currentTime;
      const st = info?.playerState ?? (m.event === 'onStateChange' && typeof m.info === 'number' ? m.info : undefined);
      if (st == null || st === ytState.current) return;
      ytState.current = st;
      if (Date.now() - applied.current < ECHO_MS) return;
      if (st === 1 && !video.playing) send(true);
      if (st === 2 && video.playing) send(false);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  });
  const listen = () => { yt.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'mock' }), '*'); setTimeout(() => applyRef.current(), 400); };

  // A file player's own controls.
  const ownEvent = () => Date.now() - applied.current < ECHO_MS;
  const onPlay = () => { if (!ownEvent() && !video.playing) send(true); };
  const onPause = () => { if (!ownEvent() && video.playing && !file.current?.ended) send(false); };
  const onSeeked = () => { if (!ownEvent() && !isLive()) send(!(file.current?.paused ?? true)); };

  if (!video.url) return null;
  return (
    <section className="wb-video" aria-label="Shared video">
      <div className="wb-video-frame">
        {src?.kind === 'youtube' && <iframe ref={yt} title="Shared video" src={src.embed} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" onLoad={listen} />}
        {el && <video ref={file} src={src?.kind === 'file' ? src.url : undefined} controls playsInline preload="metadata" onPlay={onPlay} onPause={onPause} onSeeked={onSeeked} onLoadedMetadata={() => applyRef.current()} onError={() => setFailed('The video could not load.')} />}
        {src?.kind === 'mjpeg' && <img src={src.url} alt="Live camera stream" onError={() => setFailed('The camera stream could not load.')} />}
        {!src && <span className="sub">{videoProblem(video.url)}</span>}
        {failed && <span className="wb-video-err">{failed}</span>}
      </div>
      <div className="wb-video-bar">
        <span className="sub grow">{src?.kind === 'mjpeg' ? 'Live for everyone' : (video.playing ? 'Playing for everyone' : 'Paused for everyone') + (isLive() ? ' · live' : '')}</span>
        {blocked && <button type="button" className="btn sm cool" onClick={() => { setBlocked(false); applyRef.current(); }}>Join playback</button>}
        {!readOnly && src?.kind !== 'mjpeg' && (video.playing
          ? <button type="button" className="btn sm" onClick={() => send(false)}>Pause for everyone</button>
          : <button type="button" className="btn sm primary" onClick={() => send(true)}>Play for everyone</button>)}
        <button type="button" className="text-btn" onClick={() => applyRef.current()}>Sync me</button>
        {!readOnly && <button type="button" className="text-btn" onClick={() => onChange((b) => setVideo(b, null))}>Remove</button>}
      </div>
    </section>
  );
}
