// Mock — the Areas game. A round deals tagged questions from the bank; for each one the
// player taps every area it belongs to and checks: +5 for the primary area, +2 for a secondary
// one, −2 for an area the question isn't tagged with. The reveal colours every area, then the
// next question. Finished rounds are saved with the settings (gamePlays) and feed the best
// score, recent plays and per-area accuracy on the start view. Buttons only, so mouse, touch
// and keyboard all work the same way.

import { useMemo, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { Icon } from '../components/ui.tsx';
import { GAME_POINTS, ROUND_SIZE, areaAccuracy, bestPlay, dealRound, newPlayId, playable, scoreAnswer, tally, withPlay, type AreaTally, type GamePlay, type Scored } from '../domain/game.ts';
import type { Lp, Question } from '../domain/types.ts';
import '../styles/screens/game.css';

interface Round {
  questions: Question[];
  index: number;
  selected: string[];
  revealed: Scored | null;
  score: number;
  max: number;
  areas: Record<string, AreaTally>;
  startedAt: string;
  answered: number;
}

const playDate = (iso: string): string => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const signed = (n: number): string => (n > 0 ? '+' + n : String(n));

export default function Game() {
  const { data, repo, refresh, toast } = useApp();
  const { lps, questions, settings } = data;
  const plays = settings.gamePlays ?? [];
  const areaIds = useMemo(() => new Set(lps.map((l) => l.id)), [lps]);
  const pool = useMemo(() => playable(questions, areaIds), [questions, areaIds]);
  const [round, setRound] = useState<Round | null>(null);
  const [last, setLast] = useState<GamePlay | null>(null);

  const start = () => {
    setLast(null);
    setRound({ questions: dealRound(pool, ROUND_SIZE), index: 0, selected: [], revealed: null, score: 0, max: 0, areas: {}, startedAt: new Date().toISOString(), answered: 0 });
  };

  const save = async (r: Round) => {
    if (r.answered === 0) { setRound(null); return; }
    const play: GamePlay = { id: newPlayId(), startedAt: r.startedAt, endedAt: new Date().toISOString(), questions: r.answered, score: r.score, max: r.max, areas: r.areas };
    setRound(null); setLast(play);
    try { await repo.setSettings({ gamePlays: withPlay(plays, play) }); await refresh(); } catch { toast('Could not save this game'); }
  };

  if (round) return <Play round={round} lps={lps} setRound={setRound} onFinish={save} />;
  return <Start lps={lps} plays={plays} last={last} poolSize={pool.length} onStart={start} />;
}

// ---------- Start / results ----------

function Start({ lps, plays, last, poolSize, onStart }: { lps: Lp[]; plays: GamePlay[]; last: GamePlay | null; poolSize: number; onStart: () => void }) {
  const best = bestPlay(plays);
  const acc = useMemo(() => areaAccuracy(plays), [plays]);
  const name = (id: string) => lps.find((l) => l.id === id)?.name ?? id;
  const recent = plays.slice(-5).reverse();
  return (
    <div className="screen game">
      <div className="screen-head">
        <div className="stack g4">
          <span className="h1">Game</span>
          <span className="sub">Which area does each question test? {signed(GAME_POINTS.primary)} primary · {signed(GAME_POINTS.secondary)} secondary · {GAME_POINTS.invalid} wrong</span>
        </div>
      </div>
      <div className="screen-body">
        {last && (
          <div className="card pad tint cool gm-result" role="status">
            <span className="label cool">Round over</span>
            <span className="gm-big mono">{last.score}<span className="of"> / {last.max}</span></span>
            <span className="sub">{last.questions} {last.questions === 1 ? 'question' : 'questions'}{best && best.id === last.id && plays.length > 1 ? ' · new best' : ''}</span>
          </div>
        )}
        <div className="gm-tiles">
          <div className="card pad gm-tile"><span className="gm-tile-n mono">{best ? best.score : '—'}</span><span className="label">Best score</span></div>
          <div className="card pad gm-tile"><span className="gm-tile-n mono">{plays.length}</span><span className="label">Games played</span></div>
        </div>
        <button className="btn xl primary block" onClick={onStart} disabled={poolSize === 0}><Icon.Play size={20} />{last ? 'Play again' : 'Start a round'}</button>
        <span className="sub gm-note">{poolSize === 0 ? 'No tagged questions yet. Tag questions with areas in the Library to play.' : `${Math.min(ROUND_SIZE, poolSize)} questions per round from ${poolSize} tagged.`}</span>
        {acc.length > 0 && (
          <section className="stack g8">
            <span className="label">Accuracy by area</span>
            <div className="list r12">
              {acc.map((a) => (
                <div key={a.areaId} className="row gm-acc">
                  <span className="gm-acc-name">{name(a.areaId)}</span>
                  <span className="gm-bar" aria-hidden="true"><span style={{ width: a.pct + '%' }} className={a.pct >= 70 ? 'good' : a.pct >= 40 ? 'mid' : 'low'} /></span>
                  <span className="mono gm-acc-pct" aria-label={`${a.pct}% · ${a.hit} right, ${a.miss} missed, ${a.wrong} wrong`}>{a.pct}%</span>
                </div>
              ))}
            </div>
          </section>
        )}
        {recent.length > 0 && (
          <section className="stack g8">
            <span className="label">Recent games</span>
            <div className="list r12">
              {recent.map((p) => (
                <div key={p.id} className="row gm-play">
                  <span className="sub">{playDate(p.endedAt)}</span>
                  <span className="sub">{p.questions} q</span>
                  <span className="mono gm-play-score">{p.score}<span className="of"> / {p.max}</span></span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------- One question ----------

function Play({ round, lps, setRound, onFinish }: { round: Round; lps: Lp[]; setRound: (r: Round) => void; onFinish: (r: Round) => void }) {
  const q = round.questions[round.index];
  const rev = round.revealed;
  const isLast = round.index >= round.questions.length - 1;

  const toggle = (id: string) => {
    if (rev) return;
    const on = round.selected.includes(id);
    setRound({ ...round, selected: on ? round.selected.filter((x) => x !== id) : [...round.selected, id] });
  };
  const check = () => {
    const s = scoreAnswer(q, round.selected);
    setRound({ ...round, revealed: s, score: round.score + s.score, max: round.max + s.max, areas: tally({ ...round.areas }, s), answered: round.answered + 1 });
  };
  const next = () => {
    if (isLast) { onFinish(round); return; }
    setRound({ ...round, index: round.index + 1, selected: [], revealed: null });
  };

  const stateOf = (id: string): string => {
    if (!rev) return round.selected.includes(id) ? 'sel' : '';
    const p = rev.picks.find((x) => x.areaId === id);
    if (p) return p.role ? 'hit ' + p.role : 'wrong';
    const m = rev.missed.find((x) => x.areaId === id);
    return m ? 'miss ' + m.role : 'dim';
  };
  const badge = (id: string): string | null => {
    if (!rev) return null;
    const p = rev.picks.find((x) => x.areaId === id);
    if (p) return signed(p.points);
    const m = rev.missed.find((x) => x.areaId === id);
    return m ? (m.role === 'primary' ? 'primary' : 'secondary') : null;
  };

  return (
    <div className="screen game" data-phase={rev ? 'revealed' : 'answering'}>
      <div className="screen-head">
        <button className="back-btn" onClick={() => onFinish(round)}><Icon.Close size={18} />End</button>
        <span className="mono gm-progress" aria-label={`Question ${round.index + 1} of ${round.questions.length}`}>{round.index + 1}/{round.questions.length}</span>
        <span className="mono gm-score" aria-label={`Score ${round.score}`}>{round.score}</span>
      </div>
      <div className="screen-body">
        <div className="card pad-lg gm-q">
          <span className="label">Which areas?</span>
          <p className="gm-q-text">{q.text}</p>
        </div>
        <div className="gm-areas" role="group" aria-label="Areas">
          {lps.map((l) => {
            const st = stateOf(l.id);
            const b = badge(l.id);
            return (
              <button key={l.id} type="button" className={'gm-area ' + st} aria-pressed={round.selected.includes(l.id)} disabled={!!rev && st === 'dim'} onClick={() => toggle(l.id)}>
                <span className="gm-area-name">{l.name}</span>
                {b && <span className="gm-area-badge mono">{b}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="screen-foot">
        {rev && (
          <div className={'gm-delta ' + (rev.score > 0 ? 'up' : rev.score < 0 ? 'down' : '')} role="status">
            <span className="mono">{signed(rev.score)}</span>
            <span className="sub">{rev.missed.length ? 'missed ' + rev.missed.map((m) => lps.find((l) => l.id === m.areaId)?.name ?? m.areaId).join(', ') : rev.score === rev.max ? 'perfect' : 'all areas found'}</span>
          </div>
        )}
        {rev
          ? <button className="btn lg ink block" onClick={next}>{isLast ? 'Finish' : 'Next'}<Icon.Forward size={20} /></button>
          : <button className="btn lg primary block" onClick={check} disabled={round.selected.length === 0}><Icon.Check size={20} />Check</button>}
      </div>
    </div>
  );
}
