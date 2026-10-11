// Sheets shared across screens: the new-session setup ("3 decisions": what · coaching · go,
// with "Something else" as a second page), the ✦ model answer, add a question, add a story.
// All read the app through useApp(); App.tsx mounts them once and passes open/onClose.

import React, { useEffect, useMemo, useState } from 'react';
import { useApp, type LiveStart } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { Icon, Input, Seg, Select, Sheet, Switch, VerdictChip, v } from '../components/ui.tsx';
import { newId } from '../db/repo.ts';
import { latestSessionNumber, type LpRow, type QuestionRow, type StoryRow } from '../domain/selectors.ts';
import type { Coaching, Lp, PrepFile, Question, QuestionSource, QuestionSourceSetting, Story } from '../domain/types.ts';
import { INTERVIEWERS } from '../fixtures/sample.ts';
import { writeModelAnswer } from '../gemini/model-answer.ts';
import { todayQueue, focusWhy } from './Home.tsx';
import '../styles/screens/home.css';

// ---------- shared helpers ----------

/** mulberry32 — the prototype's seeded generator, so "same seed, same take". */
const rng = (seed: number): (() => number) => {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
const hashText = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const newSeed = (): number => Math.floor(Math.random() * 90000) + 10000;
const lc = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);
const pickOne = <T,>(xs: T[], r: () => number): T => xs[Math.floor(r() * xs.length)];

const SOURCE_SETTING_LABEL: Record<QuestionSourceSetting, string> = { bank: 'Question bank', previous: 'Previous interviews', ai: 'AI-generated', mix: 'Mix of sources' };

/** The prototype's keyword tagger (mock-import.js guessLp, trimmed): first hit wins. */
const KW: [string, string][] = [['customer', 'co'], ['client', 'co'], ['simplif', 'inv'], ['invent', 'inv'], ['wrong', 'right'], ['judg', 'right'], ['learn', 'learn'], ['curious', 'learn'], ['hire', 'hire'], ['hiring', 'hire'], ['develop', 'hire'], ['mentor', 'hire'], ['standard', 'std'], ['quality', 'std'], ['refused to ship', 'std'], ['ambitious', 'big'], ['think big', 'big'], ['bold', 'big'], ['without all the data', 'bias'], ['quick decision', 'bias'], ['frugal', 'frugal'], ['fewer resources', 'frugal'], ['budget', 'frugal'], ['trust', 'trust'], ['bad news', 'trust'], ['candid', 'trust'], ['dive deep', 'deep'], ['others had missed', 'deep'], ['root cause', 'deep'], ['disagree', 'back'], ['pushed back', 'back'], ['manager', 'back'], ['deadline', 'deliver'], ['deliver', 'deliver'], ['missed', 'deliver'], ['burnout', 'employer'], ['well-being', 'employer'], ['team morale', 'employer'], ['impact', 'scale'], ['responsib', 'scale'], ['own', 'own'], ['not your job', 'own'], ['decision', 'bias'], ['data', 'bias'], ['problem', 'deep'], ['team', 'employer'], ['big', 'big']];
export const guessLp = (text: string, lps: Lp[]): Lp | null => {
  const low = text.toLowerCase();
  if (low.trim().length < 6) return null;
  const hit = KW.find(([k]) => low.includes(k));
  return (hit && lps.find((l) => l.id === hit[1])) ?? null;
};

/** Title line of a past-interview file ("# AWS loop — March 2024" → "AWS loop — March 2024") and its round count. */
function fileLoop(f: PrepFile): { title: string; rounds: number } {
  const h1 = f.content.split('\n').find((l) => /^#\s/.test(l));
  const title = h1 ? h1.replace(/^#\s+/, '').trim() : f.name.replace(/\.[a-z]+$/i, '');
  const h2 = f.content.split('\n').filter((l) => /^##\s/.test(l));
  const rounds = h2.filter((l) => /round|interview/i.test(l)).length || h2.length;
  return { title, rounds };
}

// ---------- Setup sheet ("3 decisions") ----------

type Pick = 'focus' | 'loop' | 'lp' | 'story' | 'set' | 'replay' | 'deep' | 'bar';
type Picker = null | 'lp' | 'story' | 'set' | 'replay';
interface QuestionSet { key: string; label: string; count: number }

function Tile({ lp, children, plain }: { lp?: LpRow | null; children?: React.ReactNode; plain?: boolean }) {
  if (lp) { const d = v(lp.verdict); return <span className="opt-tile" style={{ background: d.vFill, color: d.vOnFill }} aria-hidden="true">{d.vGlyph}</span>; }
  return <span className={'opt-tile' + (plain ? ' plain' : '')} aria-hidden="true">{children}</span>;
}

export function SetupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, repo, refresh, go, gemini, live, toast } = useApp();
  const { lpRows, storyRows, questions, files, sessions, settings } = data;
  const [page, setPage] = useState<1 | 2>(1);
  const [pick, setPick] = useState<Pick>('focus');
  const [picker, setPicker] = useState<Picker>(null);
  const [more, setMore] = useState(false);
  const [selLp, setSelLp] = useState<string | null>(null);
  const [selStory, setSelStory] = useState<string | null>(null);
  const [selSet, setSelSet] = useState<string>('previous');
  const [selFile, setSelFile] = useState<string | null>(null);
  const [coaching, setCoaching] = useState<Coaching>(settings.coaching);
  const [seedText, setSeedText] = useState(String(settings.seed));

  useEffect(() => { if (open) { setPage(1); setPick('focus'); setPicker(null); setMore(false); } }, [open]);
  useEffect(() => { setCoaching(settings.coaching); }, [settings.coaching]);
  useEffect(() => { setSeedText(String(settings.seed)); }, [settings.seed]);

  const queue = useMemo(() => todayQueue(data), [data]);
  const focus: LpRow | null = queue[0]?.lp ?? lpRows[0] ?? null;
  const nextN = latestSessionNumber(sessions) + 1;
  const lpById = useMemo(() => new Map(lpRows.map((r) => [r.id, r])), [lpRows]);

  // One LP · One story · Question set · Replay — the current choice of each, with a sensible default.
  const lpPick: LpRow | null = (selLp ? lpById.get(selLp) : null) ?? focus;
  const storyDefault = (focus ? storyRows.find((s) => s.primary.includes(focus.id)) ?? storyRows.find((s) => s.secondary.includes(focus.id)) : null) ?? storyRows[0] ?? null;
  const storyPick: StoryRow | null = (selStory ? storyRows.find((s) => s.id === selStory) : null) ?? storyDefault;
  const sets: QuestionSet[] = useMemo(() => [
    { key: 'previous', label: 'Previous interviews', count: questions.filter((q) => q.source === 'previous').length },
    { key: 'Common', label: 'Common', count: questions.filter((q) => q.source === 'common').length },
    { key: 'Custom', label: 'Custom', count: questions.filter((q) => q.source === 'custom').length },
    { key: 'Not yet asked', label: 'Not yet asked', count: questions.filter((q) => q.timesAsked === 0).length },
  ], [questions]);
  const setPickObj: QuestionSet = sets.find((s) => s.key === selSet) ?? sets[0];
  const pastFiles = useMemo(() => files.filter((f) => f.type === 'Past interviews').map((f) => ({ file: f, ...fileLoop(f) })), [files]);
  const filePick = (selFile ? pastFiles.find((p) => p.file.id === selFile) : null) ?? pastFiles[0] ?? null;
  const barRaiser = INTERVIEWERS.find((i) => /bar raiser/i.test(i.role)) ?? INTERVIEWERS[0];
  const storyLps = storyPick ? [...storyPick.primary.map((id) => ({ id, role: 'primary' as const })), ...storyPick.secondary.map((id) => ({ id, role: 'secondary' as const }))] : [];

  const estimate = (p: Pick): number => {
    switch (p) {
      case 'focus': case 'lp': return 12;
      case 'loop': return settings.loopSize * 10;
      case 'story': return Math.max(1, storyLps.length) * 4.5;
      case 'set': return Math.min(Math.max(setPickObj.count, 1), 6) * 4;
      case 'replay': return Math.max(filePick?.rounds ?? 1, 1) * 10;
      case 'deep': return 15;
      case 'bar': return 18;
    }
  };
  const minutes = Math.round(estimate(pick));

  const startOptions = (): LiveStart | null => {
    switch (pick) {
      case 'focus': return focus ? { mode: 'lp', focus: focus.id, focusLabel: focus.name, coaching } : null;
      case 'loop': return { mode: 'loop', coaching };
      case 'lp': return lpPick ? { mode: 'lp', focus: lpPick.id, focusLabel: lpPick.name, coaching } : null;
      case 'story': return storyPick ? { mode: 'story', focus: storyPick.id, focusLabel: storyPick.title, coaching } : null;
      case 'set': return setPickObj.count > 0 ? { mode: 'question_set', focus: setPickObj.key, focusLabel: setPickObj.label, coaching } : null;
      case 'replay': return filePick ? { mode: 'replay', focus: filePick.file.id, focusLabel: filePick.title, coaching } : null;
      case 'deep': return focus ? { mode: 'deep_dive', focus: focus.id, focusLabel: focus.name, coaching } : null;
      case 'bar': return { mode: 'bar_raiser', focus: null, focusLabel: 'Bar raiser · ' + barRaiser.name, coaching };
    }
  };
  const start = () => {
    const o = startOptions();
    if (!o) { toast(pick === 'replay' ? 'Drop your past-loop notes in Library · Files first.' : pick === 'set' ? 'That set is empty — add questions in Library · Questions first.' : 'Add a Leadership Principle in the Library first.'); return; }
    void live.start(o);
  };

  const elseLabel = (): string | null => {
    switch (pick) {
      case 'lp': return lpPick ? 'One area · ' + lpPick.name : null;
      case 'story': return storyPick ? 'One story · ' + storyPick.title : null;
      case 'set': return 'Question set · ' + setPickObj.label;
      case 'replay': return filePick ? 'Replay · ' + filePick.title : null;
      case 'deep': return 'Deep dive' + (focus ? ' · ' + focus.name : '');
      case 'bar': return 'Bar raiser · ' + barRaiser.name.split(' ')[0];
      default: return null;
    }
  };

  const setSetting = async <K extends keyof typeof settings>(k: K, value: (typeof settings)[K]) => { await repo.setSettings({ [k]: value }); await refresh(); };
  const commitSeed = () => { const n = parseInt(seedText, 10); const seed = Number.isFinite(n) && n > 0 ? n : settings.seed; setSeedText(String(seed)); if (seed !== settings.seed) void setSetting('seed', seed); };
  const choose = (p: Pick, open?: Picker) => { setPick(p); setPicker((cur) => (open === undefined ? null : cur === open ? null : open)); };

  const page1 = (
    <>
      <div className="stack g8"><span className="label">1 · What</span>
        <div className="stack g8">
          <button type="button" className={'opt' + (pick === 'focus' ? ' on' : '')} onClick={() => setPick('focus')} aria-pressed={pick === 'focus'}>
            <Tile lp={focus} plain>{!focus && '●'}</Tile>
            <div className="opt-text"><span className="opt-title">{focus ? focus.name + ' drill' : 'Suggested drill'}</span><span className="opt-sub">Suggested · 3 questions · 12 min</span></div>
            {pick === 'focus' && <span className="opt-check" aria-hidden="true">✓</span>}
          </button>
          <button type="button" className={'opt' + (pick === 'loop' ? ' on' : '')} onClick={() => setPick('loop')} aria-pressed={pick === 'loop'}>
            <Tile plain>{settings.loopSize}</Tile>
            <div className="opt-text"><span className="opt-title">Full loop</span><span className="opt-sub">{settings.loopSize} interviewers · ~{settings.loopSize * 10} min</span></div>
            {pick === 'loop' && <span className="opt-check" aria-hidden="true">✓</span>}
          </button>
          <button type="button" className={'opt' + (elseLabel() ? ' on' : '')} onClick={() => setPage(2)}>
            <Tile plain>…</Tile>
            <div className="opt-text"><span className="opt-title">Something else</span><span className="opt-sub">{elseLabel() ?? 'One area · one story · question set · replay · bar raiser'}</span></div>
            <Icon.Forward size={16} style={{ color: 'var(--m-fg3)' }} />
          </button>
        </div>
      </div>

      <div className="stack g8"><span className="label">2 · Coaching</span>
        <Seg<Coaching> className="tall" value={coaching} onChange={(c) => { setCoaching(c); void setSetting('coaching', c); }} options={[['after_each', 'After each answer'], ['recap_only', 'Recap only']]} />
      </div>

      <div className="stack g8">
        <button type="button" className="more-row" onClick={() => setMore((m) => !m)} aria-expanded={more}>
          <div className="stack g2"><span className="more-title">More · remembered</span><span className="more-sub">{SOURCE_SETTING_LABEL[settings.questionSource]} · story notes {settings.storyNotes ? 'on' : 'off'} · {gemini.voice}</span></div>
          {more ? <Icon.Up size={16} style={{ color: 'var(--m-fg3)' }} /> : <Icon.Down size={16} style={{ color: 'var(--m-fg3)' }} />}
        </button>
        {more && (
          <div className="more-box">
            <Select label="Question source" value={settings.questionSource} onChange={(s) => void setSetting('questionSource', s as QuestionSourceSetting)} options={(Object.keys(SOURCE_SETTING_LABEL) as QuestionSourceSetting[]).map((k) => ({ value: k, label: SOURCE_SETTING_LABEL[k] }))} />
            <div className="more-line">
              <div className="stack g2"><span className="more-title">Story notes</span><span className="more-sub">Your STAR notes, visible only to you while you answer.</span></div>
              <Switch checked={settings.storyNotes} label="Story notes" onChange={(on) => void setSetting('storyNotes', on)} />
            </div>
            <div className="more-line">
              <div className="stack g2"><span className="more-title">Session seed</span><span className="more-sub">Decides which questions come up and the model’s take. Same seed, same session.</span></div>
              <div className="hstack" style={{ gap: 6, flex: 'none' }}>
                <input type="number" className="seed" value={seedText} onChange={(e) => setSeedText(e.target.value)} onBlur={commitSeed} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-label="Session seed" />
                <button type="button" className="seed-btn" aria-label="New seed" onClick={() => void setSetting('seed', newSeed())}>↻</button>
              </div>
            </div>
            <div className="more-line">
              <div className="stack g2"><span className="more-title">Remembered</span><span className="more-sub">Voice {gemini.voice} · {gemini.model}</span></div>
              <button type="button" className="btn link" onClick={() => { onClose(); go(paths.settings); }}>Change</button>
            </div>
          </div>
        )}
      </div>
    </>
  );

  const page2Head = (
    <div className="sheet-head">
      <button type="button" className="back-btn" style={{ height: 36 }} onClick={() => { setPage(1); setPicker(null); }}><Icon.Back size={18} />Back</button>
      <span style={{ font: '700 15px/1 var(--font-sans)' }}>Something else</span>
      <span style={{ width: 60 }} aria-hidden="true" />
    </div>
  );

  const page2 = (
    <div className="stack g8">
      {/* One area */}
      <div className={'opt' + (pick === 'lp' ? ' on' : '')}>
        <button type="button" className="opt-main" onClick={() => choose('lp')} aria-pressed={pick === 'lp'}>
          <div className="opt-text"><span className="opt-title">One area</span><span className="opt-sub">{lpPick ? lpPick.name + (selLp ? '' : ' · suggested') : 'No areas yet'}</span></div>
        </button>
        {pick === 'lp' && picker !== 'lp' && <span className="opt-check" aria-hidden="true">✓</span>}
        <button type="button" className="btn link" onClick={() => choose('lp', 'lp')} aria-expanded={picker === 'lp'}>Pick area</button>
      </div>
      {picker === 'lp' && (
        <div className="list r12 picker" role="listbox" aria-label="Leadership Principles">
          {lpRows.map((r) => (
            <button key={r.id} type="button" role="option" aria-selected={lpPick?.id === r.id} className={'row' + (lpPick?.id === r.id ? ' on' : '')} onClick={() => { setSelLp(r.id); choose('lp'); }}>
              <span className="grow ellipsis" style={{ font: '600 13px/1.2 var(--font-sans)' }}>{r.name}</span>
              <span className="muted" style={{ font: '400 11px/1 var(--font-sans)' }}>{r.lastLabel}</span>
              <VerdictChip code={r.verdict} />
            </button>
          ))}
        </div>
      )}

      {/* One story */}
      <div className={'opt col' + (pick === 'story' ? ' on' : '')}>
        <div className="hstack between" style={{ gap: 10 }}>
          <button type="button" className="opt-main" onClick={() => choose('story')} aria-pressed={pick === 'story'} disabled={!storyPick}>
            <div className="opt-text"><span className="opt-title">One story{storyPick ? ' · ' + storyPick.title : ''}</span><span className="opt-sub">{storyPick ? storyLps.length + (storyLps.length === 1 ? ' question' : ' questions') + ', one per mapped area · ~' + Math.round(estimate('story')) + ' min' : 'Add a story in the Library first'}</span></div>
          </button>
          {pick === 'story' ? <span className="opt-check" aria-hidden="true">✓</span> : !storyPick ? null : <button type="button" className="btn link" onClick={() => choose('story', 'story')}>Pick story</button>}
        </div>
        {pick === 'story' && storyPick && (
          <>
            {storyLps.length > 0 && <div className="hstack wrap" style={{ gap: 6 }}>{storyLps.map((m) => <span key={m.id} className={'lp-chip' + (m.role === 'primary' ? ' primary' : '')}>{lpById.get(m.id)?.name ?? m.id}</span>)}</div>}
            {storyLps.length === 0 && <span className="opt-note">Not mapped to any area yet — the interviewer will probe it on its own terms. <button type="button" className="btn link" onClick={() => { onClose(); go(paths.grid); }}>Map it in the grid</button></span>}
            <span className="opt-note">
              {storyPick.uses ? 'Used ' + storyPick.uses + (storyPick.uses === 1 ? ' time' : ' times') + (storyPick.overused ? ' — the coach will push you to vary it.' : '.') : 'Never used in a session yet.'}{' '}
              <button type="button" className="btn link" onClick={() => setPicker((p) => (p === 'story' ? null : 'story'))} aria-expanded={picker === 'story'}>Change story</button>
            </span>
          </>
        )}
      </div>
      {picker === 'story' && (
        <div className="list r12 picker" role="listbox" aria-label="Stories">
          {storyRows.map((s) => (
            <button key={s.id} type="button" role="option" aria-selected={storyPick?.id === s.id} className={'row' + (storyPick?.id === s.id ? ' on' : '')} onClick={() => { setSelStory(s.id); choose('story'); }}>
              <div className="stack g2 grow"><span className="ellipsis" style={{ font: '600 13px/1.2 var(--font-sans)' }}>{s.title}</span><span className="muted" style={{ font: '400 11px/1.2 var(--font-sans)' }}>{s.lpShorts.join(' · ') || 'unmapped'}</span></div>
              <span style={{ font: '400 11px/1 var(--font-sans)', color: s.overused ? 'var(--m-gold)' : 'var(--m-fg3)' }}>used {s.uses}×</span>
            </button>
          ))}
        </div>
      )}

      {/* Question set */}
      <div className={'opt' + (pick === 'set' ? ' on' : '')}>
        <button type="button" className="opt-main" onClick={() => choose('set')} aria-pressed={pick === 'set'}>
          <div className="opt-text"><span className="opt-title">Question set</span><span className="opt-sub">{setPickObj.label} · {setPickObj.count} {setPickObj.count === 1 ? 'question' : 'questions'}</span></div>
        </button>
        {pick === 'set' && picker !== 'set' && <span className="opt-check" aria-hidden="true">✓</span>}
        <button type="button" className="btn link" onClick={() => choose('set', 'set')} aria-expanded={picker === 'set'}>Pick set</button>
      </div>
      {picker === 'set' && (
        <div className="list r12 picker" role="listbox" aria-label="Question sets">
          {sets.map((s) => (
            <button key={s.key} type="button" role="option" aria-selected={setPickObj.key === s.key} className={'row' + (setPickObj.key === s.key ? ' on' : '')} onClick={() => { setSelSet(s.key); choose('set'); }} disabled={s.count === 0}>
              <span className="grow" style={{ font: '600 13px/1.2 var(--font-sans)' }}>{s.label}</span>
              <span className="num">{s.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Replay a past interview */}
      <div className={'opt' + (pick === 'replay' ? ' on' : '')}>
        <button type="button" className="opt-main" onClick={() => choose('replay')} aria-pressed={pick === 'replay'} disabled={!filePick}>
          <div className="opt-text"><span className="opt-title">Replay a past interview</span><span className="opt-sub">{filePick ? filePick.title + ' · ' + filePick.rounds + (filePick.rounds === 1 ? ' round' : ' rounds') : 'Drop your past-loop notes in Library · Files'}</span></div>
        </button>
        {pick === 'replay' && picker !== 'replay' && <span className="opt-check" aria-hidden="true">✓</span>}
        {pastFiles.length > 1 && <button type="button" className="btn link" onClick={() => choose('replay', 'replay')} aria-expanded={picker === 'replay'}>Pick file</button>}
      </div>
      {picker === 'replay' && (
        <div className="list r12 picker" role="listbox" aria-label="Past interviews">
          {pastFiles.map((p) => (
            <button key={p.file.id} type="button" role="option" aria-selected={filePick?.file.id === p.file.id} className={'row' + (filePick?.file.id === p.file.id ? ' on' : '')} onClick={() => { setSelFile(p.file.id); choose('replay'); }}>
              <div className="stack g2 grow"><span className="ellipsis" style={{ font: '600 13px/1.2 var(--font-sans)' }}>{p.title}</span><span className="muted mono" style={{ font: '400 11px/1.2 var(--font-mono)' }}>{p.file.name}</span></div>
              <span className="num">{p.rounds} rounds</span>
            </button>
          ))}
        </div>
      )}

      {/* Deep dive */}
      <button type="button" className={'opt' + (pick === 'deep' ? ' on' : '')} onClick={() => choose('deep')} aria-pressed={pick === 'deep'}>
        <div className="opt-text"><span className="opt-title">Deep dive</span><span className="opt-sub">One question, five follow-ups{focus ? ' · ' + focus.name : ''}</span></div>
        {pick === 'deep' && <span className="opt-check" aria-hidden="true">✓</span>}
      </button>

      {/* Bar raiser */}
      <button type="button" className={'opt' + (pick === 'bar' ? ' on' : '')} onClick={() => choose('bar')} aria-pressed={pick === 'bar'}>
        <div className="opt-text"><span className="opt-title">Bar raiser</span><span className="opt-sub">{barRaiser.name.split(' ')[0]} · 4 questions across areas</span></div>
        {pick === 'bar' && <span className="opt-check" aria-hidden="true">✓</span>}
      </button>
    </div>
  );

  const foot = page === 1
    ? (<><span className="label">3 · Go</span><button type="button" className="btn xl primary" style={{ height: 60, fontSize: 17 }} onClick={start}>Start</button></>)
    : (<button type="button" className="btn xl primary" style={{ height: 60, fontSize: 17, gap: 10 }} onClick={start}>Start<span style={{ font: '500 13px/1 var(--font-mono)', opacity: .8 }}>~{minutes} min</span></button>);

  return (
    <Sheet open={open} onClose={onClose} title={'Session ' + nextN} head={page === 2 ? page2Head : undefined} foot={foot}>
      {page === 1 ? page1 : page2}
    </Sheet>
  );
}

// ---------- ✦ Model answer ----------

/**
 * A STAR answer composed locally from the candidate's own stories, deterministic from the
 * seed: the seed picks the story (primary-mapped first) and the angle.
 * With a key the sheet asks Flash instead (gemini/model-answer.ts, same seed, same format);
 * this stays the offline answer and the fallback when that call fails.
 */
export function composeModelAnswer(q: QuestionRow, stories: Story[], lps: Lp[], seed: number): string {
  const r = rng(seed ^ hashText(q.id));
  const lpId = q.lpIds[0] ?? null;
  const lp = lpId ? lps.find((l) => l.id === lpId) ?? null : null;
  const primary = stories.filter((s) => s.links.some((k) => k.lpId === lpId && k.role === 'primary'));
  const secondary = stories.filter((s) => s.links.some((k) => k.lpId === lpId && k.role === 'secondary'));
  const pool = primary.length ? primary : secondary.length ? secondary : stories;
  if (!pool.length) return 'Add a story in the Library and Mock will write a model answer from it, with its real numbers.';
  const story = pickOne(pool, r);
  const nums = story.numbers.map((n) => (n.label ? n.label + ' ' + n.value : n.value)).filter(Boolean);
  const lead = nums.slice().sort(() => r() - 0.5).slice(0, 2);
  const situation = (lead.length ? 'The short version: ' + lead.join(', ') + '. ' : '') + (story.situation || story.summary);
  const task = story.task || 'My job was to ' + pickOne(['get to the root cause myself', 'make the call and own it', 'turn it around without slowing the team'], r) + ', and to say so plainly to the people who depended on it.';
  const action = story.action || 'I ' + pickOne(['traced the problem myself before delegating any of it', 'split the work so the team could move in parallel while I took the riskiest part', 'set a trip-wire, shipped, and checked it every day'], r) + ', and kept the numbers in front of everyone as we went.';
  const result = story.result || (nums.length ? 'The result: ' + nums.join(', ') + '.' : 'It landed, and it held.');
  const why = lp
    ? 'Why this works for ' + lp.name + ' — ' + lc(lp.description.split('.')[0]) + '. ' + (lead.length ? 'The numbers (' + lead.join(', ') + ') come first, ' : 'The result comes first, ') + pickOne(['and every sentence names what I did, not what we did.', 'and the follow-up has somewhere to go: the interviewer can dig into any of them.', 'and the story stops at the result instead of drifting into context.'], r)
    : 'Why this works — the numbers come first and every sentence names what I did.';
  return ['Situation — ' + situation, 'Task — ' + task, 'Action — ' + action, 'Result — ' + result, story.learning ? 'What I took from it — ' + story.learning : '', why].filter(Boolean).join('\n\n');
}

export function AnswerSheet({ question, onClose }: { question: QuestionRow | null; onClose: () => void }) {
  const { data, repo, refresh, live, gemini, toast } = useApp();
  const seed = data.settings.seed;
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [byFlash, setByFlash] = useState(false);
  const questionId = question?.id ?? null;

  useEffect(() => {
    if (!question) return;
    setLoading(true); setText(''); setByFlash(false);
    const local = () => composeModelAnswer(question, data.stories, data.lps, seed);
    if (!gemini.key || !data.stories.length) {
      // Offline: the local composer (a short pause so the sheet reads as "writing").
      const t = setTimeout(() => { setText(local()); setLoading(false); }, 450);
      return () => clearTimeout(t);
    }
    const ctl = new AbortController();
    const lp = data.lps.find((l) => l.id === question.lpIds[0]) ?? null;
    writeModelAnswer({ key: gemini.key, model: data.settings.textModel, question: question.text, lp, stories: data.stories, seed, signal: ctl.signal })
      .then((t) => { if (!ctl.signal.aborted) { setText(t); setByFlash(true); } })
      .catch((err: Error) => { if (ctl.signal.aborted) return; setText(local()); toast('Flash unavailable — wrote it offline (' + err.message + ')'); })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId, seed, gemini.key]);

  const another = async () => { await repo.setSettings({ seed: newSeed() }); await refresh(); };
  const askLive = () => { if (question) void live.start({ mode: 'question_set', focus: question.id, questionText: question.text, focusLabel: question.lpName }); };

  return (
    <Sheet open={!!question} onClose={onClose} tall zIndex={12} eyebrow={'✦ Model answer · seed ' + seed + (byFlash ? ' · Flash' : '')} title="From your own stories"
      foot={<div className="hstack" style={{ gap: 8 }}><button type="button" className="btn cool grow" onClick={() => void another()}>Another take · new seed</button><button type="button" className="btn grow" onClick={askLive}>Ask me this live</button></div>}>
      {question && (
        <div className="stack g14">
          <div className="answer-q">{question.text}</div>
          {loading && <div className="hstack sub" style={{ gap: 10, font: '500 13px/1.3 var(--font-sans)' }} role="status"><span className="spinner cool" />Writing a STAR answer from your stories…</div>}
          {!loading && !!text && <div className="answer-text">{text}</div>}
          {!!question.sample && <div className="answer-sample"><span className="label" style={{ fontSize: 10 }}>Top community answer · Exponent</span><span className="sub" style={{ fontSize: 12, lineHeight: 1.5 }}>{question.sample}</span></div>}
        </div>
      )}
    </Sheet>
  );
}

// ---------- Add a question ----------

const SOURCE_OPTIONS: { value: QuestionSource; label: string }[] = [{ value: 'custom', label: 'Custom' }, { value: 'previous', label: 'Previous interview' }, { value: 'common', label: 'Common' }];

export function AddQuestionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, repo, refresh, toast, live } = useApp();
  const [text, setText] = useState('');
  const [lpManual, setLpManual] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [source, setSource] = useState<QuestionSource>('custom');
  const [difficulty, setDifficulty] = useState<'1' | '2' | '3'>('2');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setText(''); setLpManual(null); setChanging(false); setSource('custom'); setDifficulty('2'); setBusy(false); } }, [open]);

  const guessed = useMemo(() => guessLp(text, data.lps), [text, data.lps]);
  const lpId = lpManual ?? guessed?.id ?? '';
  const lpName = data.lps.find((l) => l.id === lpId)?.name ?? 'Untagged';
  const ok = text.trim().length > 8 && !busy;

  const build = (): Question => ({
    id: newId('q'), text: text.trim(), lpIds: lpId ? [lpId] : [], source, difficulty: Number(difficulty) as 1 | 2 | 3,
    timesAsked: 0, lastVerdict: null, bestExchangeId: null, tags: '', votes: 0, sample: '', createdAt: new Date().toISOString(),
  });
  const save = async (): Promise<Question | null> => {
    if (!ok) return null;
    setBusy(true);
    const q = build();
    const n = await repo.addQuestions([q]);
    await refresh();
    setBusy(false);
    if (!n) { toast('That question is already in your bank.'); return null; }
    return q;
  };
  const saveToBank = async () => { const q = await save(); if (q) { toast('Saved to the bank' + (q.lpIds.length ? ' · ' + lpName : ' · untagged')); onClose(); } };
  const saveAndAsk = async () => { const q = await save(); if (q) void live.start({ mode: 'question_set', focus: q.id, questionText: q.text, focusLabel: lpName }); };

  return (
    <Sheet open={open} onClose={onClose} title="New question" zIndex={14}
      foot={<div className="hstack" style={{ gap: 10 }}><button type="button" className="btn lg ink grow" disabled={!ok} onClick={() => void saveToBank()}>Save to bank</button><button type="button" className="btn lg" style={{ padding: '0 18px', fontSize: 14 }} disabled={!ok} onClick={() => void saveAndAsk()}>Save &amp; ask now</button></div>}>
      <div className="stack g16">
        <Input label="Question" multiline value={text} rows={4} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)} placeholder="Tell me about a time you had to make a call between two of your own priorities." />
        <div className="field">
          <span className="field-label">Area</span>
          <div className="lp-field">
            <span className={lpId ? '' : 'muted'}>{lpName}</span>
            <button type="button" className="btn link" style={{ font: '700 11px/1 var(--font-sans)' }} onClick={() => setChanging((c) => !c)} aria-expanded={changing}>
              {lpManual ? 'Chosen · change' : guessed ? 'Suggested · change' : 'Pick'}
            </button>
          </div>
          {changing && <Select value={lpId} onChange={(id) => { setLpManual(id || null); setChanging(false); }} options={[{ value: '', label: 'Untagged' }, ...data.lps.map((l) => ({ value: l.id, label: l.name }))]} />}
          {!changing && !lpManual && guessed && <span className="field-hint">Suggested from the wording · untagged questions stay flagged in the bank, never a blocker.</span>}
        </div>
        <Select label="Source" value={source} onChange={(s) => setSource(s as QuestionSource)} options={SOURCE_OPTIONS} />
        <div className="field">
          <span className="field-label">Difficulty</span>
          <Seg<'1' | '2' | '3'> className="diff" value={difficulty} onChange={setDifficulty} options={[['1', 'Easy'], ['2', 'Medium'], ['3', 'Hard']]} />
        </div>
      </div>
    </Sheet>
  );
}

// ---------- Add a story ----------

export function AddStorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, repo, refresh, go, toast } = useApp();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [lp, setLp] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setTitle(''); setSummary(''); setLp(''); setBusy(false); } }, [open]);
  const ok = title.trim().length > 2 && !busy;

  const create = async () => {
    if (!ok) return;
    setBusy(true);
    const now = new Date().toISOString();
    const story: Story = { id: newId('st'), title: title.trim(), summary: summary.trim(), situation: '', task: '', action: '', result: '', learning: '', numbers: [], links: lp ? [{ lpId: lp, role: 'primary' }] : [], createdAt: now, updatedAt: now };
    await repo.upsertStory(story);
    await refresh();
    setBusy(false);
    toast('Story created · add the STAR and its numbers');
    onClose();
    go(paths.story(story.id));
  };

  return (
    <Sheet open={open} onClose={onClose} title="New story" zIndex={14} foot={<button type="button" className="btn lg ink" disabled={!ok} onClick={() => void create()}>Create story</button>}>
      <div className="stack g16">
        <Input label="Title" value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} placeholder="Payments outage" autoFocus />
        <Input label="One-line summary" multiline rows={3} value={summary} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSummary(e.target.value)} placeholder="Led a Sev-1 recovery on the card-payments path during Black Friday week." />
        <Select label="Primary area" value={lp} onChange={setLp} options={[{ value: '', label: 'Map it in the grid later' }, ...data.lps.map((l) => ({ value: l.id, label: l.name }))]} />
        <span className="sub">Situation, Task, Action, Result, the learning and the key numbers go in the editor once the story exists.</span>
      </div>
    </Sheet>
  );
}
