// Mock — the analysis card (AnalysisCard.dc.html). One per answer: verdict, the better story
// when there is one, the numbers you missed (notes → said), the STAR time split, I-vs-we,
// delivery, one strength and up to three fixes. `compact` drops the STAR / I-vs-we / delivery
// block (the second card onwards in History; the phone coaching panel). The footer buttons
// are disabled when no handler is given.
import React from 'react';
import type { Exchange, MissedNumber, StarSplit, VerdictCode } from '../domain/types.ts';
import { verdictCode } from '../domain/types.ts';
import { Icon, fmtClock, v } from './ui.tsx';
import '../styles/screens/analysis-card.css';

/** The card's data contract, as the design declares it. */
export interface AnalysisCardData {
  q: string;
  question: string;
  lp: string;
  story: string;
  verdict: VerdictCode;
  better?: string;
  reason?: string;
  missed: MissedNumber[];
  star: StarSplit;
  iPct: number;
  pace: number;
  paceNote: string;
  fillers: number;
  length: string;
  lengthNote: string;
  strength: string;
  fixes: string[];
  /** Set when this answer is the saved best attempt for its question. */
  isBest?: boolean;
}

export interface AnalysisCardProps {
  data: AnalysisCardData;
  compact?: boolean;
  onPlay?: () => void;
  onDrill?: () => void;
  onSaveBest?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

const EVEN_STAR: StarSplit = { s: 25, t: 25, a: 25, r: 25 };

/** "Result thin — aim for 25%" · "Situation long — aim for 20%" · "Balanced" */
export const starNote = (star: StarSplit): string => (star.r < 20 ? 'Result thin — aim for 25%' : star.s > 30 ? 'Situation long — aim for 20%' : 'Balanced');
/** "Mostly “we” — own the actions" · "Good — you own the actions" */
export const iNote = (iPct: number): string => (iPct < 50 ? 'Mostly “we” — own the actions' : 'Good — you own the actions');

/** The card for one exchange. `index` is the answer's position in the session (Q1 = 0); `lpName` is the fallback when the analysis names no LP. */
export function cardFromExchange(exchange: Exchange, index: number, lpName?: string): AnalysisCardData {
  const a = exchange.analysis;
  const durationSec = a?.delivery.durationSec ?? Math.max(0, ((exchange.endMs ?? exchange.startMs) - exchange.startMs) / 1000);
  return {
    q: 'Q' + (index + 1),
    question: exchange.questionText,
    lp: a?.lp || lpName || exchange.lpId || '—',
    story: exchange.storyTitle ?? a?.storyUsed ?? '—',
    verdict: verdictCode(exchange.verdict ?? a?.verdict),
    better: a?.betterStory?.title,
    reason: a?.betterStory?.reason,
    missed: a?.numbersMissed ?? [],
    star: a?.star ?? EVEN_STAR,
    iPct: a ? Math.round(a.iWeRatio * 100) : 0,
    pace: a?.delivery.paceWpm ?? 0,
    paceNote: a?.delivery.paceNote ?? '—',
    fillers: a?.delivery.fillers ?? 0,
    length: fmtClock(durationSec),
    lengthNote: a?.delivery.lengthNote ?? 'length',
    strength: a?.strength ?? '',
    fixes: a?.fixes ?? [],
    isBest: exchange.isBest,
  };
}

const STAR_COLOURS: [keyof StarSplit, string, string][] = [['s', 'S', 'var(--m-line2)'], ['t', 'T', 'var(--m-fg3)'], ['a', 'A', 'var(--m-fg2)'], ['r', 'R', 'var(--m-cool)']];

export default function AnalysisCard({ data: a, compact = false, onPlay, onDrill, onSaveBest, style, className = '' }: AnalysisCardProps) {
  const d = v(a.verdict);
  const star = a.star ?? EVEN_STAR;
  const missed = a.missed ?? [];
  const fixes = a.fixes ?? [];
  return (
    <article className={'ac' + (compact ? ' compact' : '') + (className ? ' ' + className : '')} style={style} aria-label={a.q + ' · ' + a.lp + ' · ' + d.vLabel}>
      <header className="ac-head">
        <div className="ac-title">
          <div className="ac-eyebrow"><span>{a.q}</span><span>·</span><span className="ac-lp">{a.lp}</span></div>
          <div className="ac-q">{a.question}</div>
          <div className="ac-story">Story used · <span>{a.story || '—'}</span></div>
        </div>
        <span className="ac-verdict" style={{ background: d.vBg, color: d.vFg, border: d.vBorder }}><span>{d.vGlyph}</span>{d.vLabel}</span>
      </header>

      {!!a.better && (
        <div className="ac-better">
          <span className="ac-better-label">Better story</span>
          <div className="ac-better-body"><div className="ac-better-title">{a.better}</div>{!!a.reason && <div className="ac-better-reason">{a.reason}</div>}</div>
        </div>
      )}

      {missed.length > 0 && (
        <div className="ac-sec">
          <div className="ac-label">Numbers you missed · notes → said</div>
          <div className="ac-missed">
            {missed.map((m, i) => (
              <span key={i} className="ac-miss"><span className="n">{m.notes}</span><span className="arrow" aria-hidden="true">→</span><span className="said">{m.said}</span></span>
            ))}
          </div>
        </div>
      )}

      {!compact && (
        <div className="ac-full">
          <div className="ac-sec">
            <div className="ac-star-head"><span className="ac-label">STAR · time split</span><span className="ac-star-note">{starNote(star)}</span></div>
            <div className="ac-star-bar" role="img" aria-label={'Situation ' + star.s + '%, task ' + star.t + '%, action ' + star.a + '%, result ' + star.r + '%'}>
              {STAR_COLOURS.map(([k, , bg]) => <span key={k} style={{ width: star[k] + '%', background: bg }} />)}
            </div>
            <div className="ac-star-legend">
              {STAR_COLOURS.map(([k, label, bg]) => <span key={k}><span className="ac-sw" style={{ background: bg }} />{label} {star[k]}%</span>)}
            </div>
          </div>
          <div className="ac-grid">
            <div className="ac-box">
              <span className="ac-label">I vs we</span>
              <div className="ac-big"><span className="ac-big-n">{a.iPct}%</span><span className="ac-note">“I”</span></div>
              <div className="ac-i-bar"><span style={{ width: Math.max(0, Math.min(100, a.iPct)) + '%' }} /></div>
              <span className="ac-note">{iNote(a.iPct)}</span>
            </div>
            <div className="ac-box">
              <span className="ac-label">Delivery</span>
              <div className="ac-delivery">
                <div className="ac-stat"><span className="ac-stat-n">{a.pace}</span><span className="ac-stat-l">wpm · {a.paceNote}</span></div>
                <div className="ac-stat"><span className="ac-stat-n">{a.fillers}</span><span className="ac-stat-l">fillers</span></div>
                <div className="ac-stat"><span className="ac-stat-n">{a.length}</span><span className="ac-stat-l">{a.lengthNote || 'length'}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="ac-notes">
        {a.strength ? (
          <div className="ac-line">
            <span className="ac-dot ok" aria-hidden="true">✓</span>
            <div className="ac-strength"><span className="ac-strength-label">Strength</span><span className="ac-text">{a.strength}</span></div>
          </div>
        ) : (
          <span className="ac-note">No analysis for this answer yet.</span>
        )}
        {fixes.map((t, i) => (
          <div key={i} className="ac-line">
            <span className="ac-dot fix mono" aria-hidden="true">{i + 1}</span>
            <span className="ac-text ac-fix">{t}</span>
          </div>
        ))}
      </div>

      <footer className="ac-foot">
        <button type="button" className="ac-btn" onClick={onPlay} disabled={!onPlay} aria-label={'Play answer, ' + a.length}><Icon.Play size={16} />Play answer <span className="ac-len">{a.length}</span></button>
        <button type="button" className="ac-btn" onClick={onSaveBest} disabled={!onSaveBest} aria-pressed={a.isBest ? true : undefined}>
          {a.isBest ? <><Icon.Check size={16} />Best attempt</> : 'Save as best attempt'}
        </button>
        <button type="button" className="ac-btn cool" onClick={onDrill} disabled={!onDrill}>Drill <span>{a.lp}</span></button>
      </footer>
    </article>
  );
}
