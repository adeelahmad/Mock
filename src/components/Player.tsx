// Mock — the recording player (History board: "Session detail · player" and the desktop
// waveform/chapter player). A waveform strip with the played part in ink and a gold playhead,
// one chapter mark per question, position / total, ±15 s, play/pause, a speed chip and
// "Skip my answers". `usePlayback` owns the clock so the transcript can follow it and the
// analysis cards can seek it. With a recording the <audio> element drives the clock; without
// one the clock runs on the transcript timings so the sync still works on sample data.
// M4: the waveform is drawn from the real recording (today: deterministic bars from the id).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, fmt } from './ui.tsx';
import '../styles/screens/player.css';

export type Speed = 1 | 1.5 | 2;
const SPEEDS: Speed[] = [1, 1.5, 2];
export const SKIP_MS = 15000;
const TICK_MS = 100;

export interface Chapter { id: string; index: number; label: string; lp: string; startMs: number; endMs: number }
export interface PlaybackSpan { startMs: number; endMs: number }

export interface Playback {
  positionMs: number;
  totalMs: number;
  playing: boolean;
  speed: Speed;
  skipMine: boolean;
  /** A recording is attached and playable. */
  hasAudio: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (ms: number) => void;
  skip: (deltaMs: number) => void;
  cycleSpeed: () => void;
  setSkipMine: (on: boolean) => void;
  /** Props for the hidden <audio> element the Player renders. */
  audioProps: React.AudioHTMLAttributes<HTMLAudioElement> & { ref: (el: HTMLAudioElement | null) => void };
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

export function usePlayback({ src, totalMs, skipSpans }: { src: string | null; totalMs: number; skipSpans: PlaybackSpan[] }): Playback {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [skipMine, setSkipMine] = useState(false);
  const [audioMs, setAudioMs] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const useAudio = !!src && !broken;
  const total = Math.max(1000, audioMs ?? totalMs);

  // Refs so the actions stay stable and the clock reads fresh values.
  const posRef = useRef(0);
  const lastRef = useRef(0);
  const totalRef = useRef(total); totalRef.current = total;
  const speedRef = useRef(speed); speedRef.current = speed;
  const skipRef = useRef(skipMine); skipRef.current = skipMine;
  const spansRef = useRef(skipSpans); spansRef.current = skipSpans;
  const useAudioRef = useRef(useAudio); useAudioRef.current = useAudio;
  const probing = useRef(false);

  const setPos = useCallback((ms: number) => { posRef.current = ms; setPositionMs(ms); }, []);

  /** Where playback lands when it moves from `prev` to `next`: entering one of my answers while "Skip my answers" is on jumps past it. */
  const landing = useCallback((prev: number, next: number): number => {
    if (!skipRef.current) return next;
    const span = spansRef.current.find((s) => next >= s.startMs && next < s.endMs);
    return span && prev < span.startMs ? span.endMs : next;
  }, []);

  useEffect(() => () => { audioRef.current?.pause(); }, []);
  useEffect(() => { setBroken(false); setAudioMs(null); }, [src]);
  useEffect(() => { const a = audioRef.current; if (a) a.playbackRate = speed; }, [speed]);

  // The virtual clock, when no recording drives the position.
  useEffect(() => {
    if (!playing || useAudio) return;
    let last = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) * speedRef.current; last = now;
      const prev = posRef.current;
      const next = clamp(landing(prev, prev + dt), 0, totalRef.current);
      setPos(next);
      if (next >= totalRef.current) setPlaying(false);
    }, TICK_MS);
    return () => clearInterval(t);
  }, [playing, useAudio, landing, setPos]);

  const play = useCallback(() => {
    const a = audioRef.current;
    if (useAudioRef.current && a) {
      if (posRef.current >= totalRef.current - 250) { a.currentTime = 0; setPos(0); }
      void a.play().catch(() => setBroken(true));
    } else {
      if (posRef.current >= totalRef.current - 250) setPos(0);
      setPlaying(true);
    }
  }, [setPos]);
  const pause = useCallback(() => { const a = audioRef.current; if (useAudioRef.current && a) a.pause(); setPlaying(false); }, []);
  const seek = useCallback((ms: number) => {
    const target = clamp(ms, 0, totalRef.current);
    lastRef.current = target;
    const a = audioRef.current;
    if (useAudioRef.current && a) { try { a.currentTime = target / 1000; } catch { /* not seekable yet */ } }
    setPos(target);
  }, [setPos]);
  const skip = useCallback((delta: number) => seek(posRef.current + delta), [seek]);
  const toggle = useCallback(() => { if (playing) pause(); else play(); }, [playing, pause, play]);
  const cycleSpeed = useCallback(() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]), []);

  const audioProps = useMemo<Playback['audioProps']>(() => ({
    ref: (el) => {
      audioRef.current = el;
      if (el) { el.playbackRate = speedRef.current; if (posRef.current > 0) { try { el.currentTime = posRef.current / 1000; } catch { /* metadata not loaded */ } } }
    },
    src: src ?? undefined,
    preload: 'metadata',
    onLoadedMetadata: (e) => {
      const a = e.currentTarget;
      if (Number.isFinite(a.duration) && a.duration > 0) setAudioMs(a.duration * 1000);
      else { probing.current = true; a.currentTime = 1e101; } // MediaRecorder blobs report Infinity until seeked past the end
    },
    onDurationChange: (e) => {
      const a = e.currentTarget;
      if (!Number.isFinite(a.duration) || a.duration <= 0) return;
      setAudioMs(a.duration * 1000);
      if (probing.current) { probing.current = false; a.currentTime = posRef.current / 1000; }
    },
    onTimeUpdate: (e) => {
      if (probing.current) return;
      const a = e.currentTarget;
      const ms = a.currentTime * 1000;
      const land = landing(lastRef.current, ms);
      lastRef.current = land;
      if (land !== ms) { if (land >= totalRef.current) { a.pause(); a.currentTime = totalRef.current / 1000; } else a.currentTime = land / 1000; }
      setPos(land);
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onError: () => { setBroken(true); setPlaying(false); },
  }), [src, landing, setPos]);

  return { positionMs, totalMs: total, playing, speed, skipMine, hasAudio: useAudio, play, pause, toggle, seek, skip, cycleSpeed, setSkipMine, audioProps };
}

// ---------- waveform placeholder ----------
const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Deterministic bar heights (0–100) from a seed; quiet gaps at the chapter starts (as fractions of the total). */
export function waveBars(seed: string, n: number, marks: number[]): number[] {
  const h = hash(seed);
  const p1 = ((h % 97) / 97) * Math.PI * 2, p2 = (((h >>> 8) % 89) / 89) * Math.PI * 2, p3 = (((h >>> 16) % 83) / 83) * Math.PI * 2;
  return Array.from({ length: n }, (_, i) => {
    const t = i / n;
    const env = 0.35 + (0.65 * Math.abs(Math.sin(i * 0.9 + p1) + 0.4 * Math.sin(i * 2.3 + p2) + 0.25 * Math.cos(i * 5.1 + p3))) / 1.65;
    const quiet = marks.some((m) => m > 0 && Math.abs(t - m) < 0.012);
    return Math.round((quiet ? 0.08 : env) * 100);
  });
}

export interface PlayerProps {
  pb: Playback;
  chapters: Chapter[];
  /** Seed for the placeholder waveform (the session id). */
  seed: string;
  current: Chapter | null;
  /** One line under the controls (e.g. "No recording — playback follows the transcript timings"). */
  note?: React.ReactNode;
  bars?: number;
  className?: string;
}

export default function Player({ pb, chapters, seed, current, note, bars = 72, className = '' }: PlayerProps) {
  const total = pb.totalMs;
  const pct = clamp((pb.positionMs / total) * 100, 0, 100);
  const heights = useMemo(() => waveBars(seed, bars, chapters.map((c) => c.startMs / total)), [seed, bars, chapters, total]);
  const waveRef = useRef<HTMLDivElement | null>(null);

  const seekAt = (clientX: number) => {
    const el = waveRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    pb.seek(clamp((clientX - r.left) / Math.max(1, r.width), 0, 1) * total);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); pb.skip(-SKIP_MS); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); pb.skip(SKIP_MS); }
    else if (e.key === 'Home') { e.preventDefault(); pb.seek(0); }
    else if (e.key === 'End') { e.preventDefault(); pb.seek(total); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pb.toggle(); }
  };
  const posText = fmt(pb.positionMs / 1000), totalText = fmt(total / 1000);
  const skipChip = (extra: string) => (
    <button type="button" className={'pl-chip text ' + extra + (pb.skipMine ? ' on' : '')} aria-pressed={pb.skipMine} onClick={() => pb.setSkipMine(!pb.skipMine)}>Skip my answers</button>
  );

  return (
    <div className={'pl' + (className ? ' ' + className : '')}>
      <div ref={waveRef} className="pl-wave" role="slider" tabIndex={0} aria-label="Recording position" aria-valuemin={0} aria-valuemax={Math.round(total / 1000)} aria-valuenow={Math.round(pb.positionMs / 1000)} aria-valuetext={posText + ' of ' + totalText}
        onClick={(e) => seekAt(e.clientX)} onKeyDown={onKey}>
        {heights.map((h, i) => <span key={i} className={'pl-bar' + ((i + 0.5) / heights.length * 100 <= pct ? ' played' : '')} style={{ height: h + '%' }} />)}
        <span className="pl-head" style={{ left: pct + '%' }} />
      </div>
      <div className="pl-chapters">
        {chapters.map((c, i) => {
          const left = clamp((c.startMs / total) * 100, 0, 100);
          const next = chapters[i + 1];
          const width = next ? clamp(((next.startMs - c.startMs) / total) * 100, 2, 100) : 100 - left;
          return (
            <button key={c.id} type="button" className={'pl-ch' + (current?.id === c.id ? ' on' : '')} style={{ left: left + '%', width: 'calc(' + width + '% - 4px)' }} title={c.label + ' · ' + c.lp} aria-label={'Go to ' + c.label + ', ' + c.lp} onClick={() => pb.seek(c.startMs)}>
              <span className="pl-ch-text">{c.label}<span className="pl-ch-lp"> · {c.lp}</span></span>
            </button>
          );
        })}
      </div>
      <div className="pl-ctl">
        <span className="pl-pos">{posText} <span className="pl-total">/ {totalText}</span></span>
        <div className="pl-btns">
          <button type="button" className="pl-skip" aria-label="Back 15 seconds" onClick={() => pb.skip(-SKIP_MS)}>15</button>
          <button type="button" className="pl-play" aria-label={pb.playing ? 'Pause' : 'Play'} onClick={pb.toggle}>{pb.playing ? <Icon.Pause size={20} /> : <Icon.Play size={20} />}</button>
          <button type="button" className="pl-skip" aria-label="Forward 15 seconds" onClick={() => pb.skip(SKIP_MS)}>15</button>
        </div>
        <div className="pl-chips">
          <button type="button" className="pl-chip" aria-label={'Playback speed ' + pb.speed + '×, tap to change'} onClick={pb.cycleSpeed}>{pb.speed}×</button>
          {skipChip('desk')}
        </div>
      </div>
      <div className="pl-row2">
        <span className="pl-now">{current ? current.label + ' · ' + current.lp : chapters.length ? 'Before Q1' : ''}</span>
        {skipChip('phone')}
      </div>
      {note && <span className="pl-note">{note}</span>}
      {pb.hasAudio || pb.audioProps.src ? <audio {...pb.audioProps} /> : null}
    </div>
  );
}
