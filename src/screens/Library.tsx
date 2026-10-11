// Library (board 3): LPs · Stories · Questions · Files behind one segmented control on the
// phone; on desktop the sidebar carries the segments and LPs is a 440 px master list with the
// detail to its right (LpDetail renders that). The import flows live here too: a dropped or
// picked file is parsed (domain/parsers.ts) and reviewed before anything reaches the bank.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { Dropzone, Icon, Seg, Switch, VerdictChip } from '../components/ui.tsx';
import { newId } from '../db/repo.ts';
import type { Lp, PrepFile, QuestionSource, Verdict } from '../domain/types.ts';
import { SOURCE_LABEL, type LpRow, type QuestionRow, type StoryRow } from '../domain/selectors.ts';
import { VERDICT_LABEL } from '../domain/verdict.ts';
import { csvKind, detectFileType, fileKind, parseAreasFromCsv, parseExponentRows, parseQuestionsFromCsv, parseStoriesFile, parsedQuestionsFromText, type ParsedQuestion, type ParsedStory } from '../domain/parsers.ts';
import { downloadTemplate } from '../components/CsvSamples.tsx';
import ImportReview, { prepareReview, type ReviewData } from './ImportReview.tsx';
import ImportStories from './ImportStories.tsx';
import { areasFromParsed, fileText } from '../domain/prep-import.ts';
import { tagWithGemini } from '../gemini/tagging.ts';
import '../styles/screens/library.css';

export type LibrarySeg = 'lps' | 'stories' | 'questions' | 'files';
const SEG_LABEL: Record<LibrarySeg, string> = { lps: 'Areas', stories: 'Stories', questions: 'Questions', files: 'Files' };
const PAGE = 40;

// ---------- small formatters ----------

const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** "Today" · "Yesterday" · "N days ago" · "Never" — the LP row's last-practised label. */
export const agoLabel = (iso: string | null, now = new Date()): string => {
  if (!iso) return 'Never';
  const d = Math.round((dayStart(now) - dayStart(new Date(iso))) / 86400000);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d + ' days ago';
};
export const fmtSize = (bytes: number): string => (bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "12 Sep" — the file row's updated date. */
export const fmtDay = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()]; };
const plural = (n: number, one: string, many = one + 's'): string => n + ' ' + (n === 1 ? one : many);
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const FileIcon = () => (
  <svg viewBox="0 0 24 24" className="ic" style={{ width: 20, height: 20 }} aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></svg>
);

// ---------- Lists (also used by the detail screens' desktop master columns) ----------

const DESK = '(min-width: 900px)';
/** True at the desktop breakpoint (the board's master rows abbreviate "questions" to "q" there). */
function useDesktop(): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(DESK).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(DESK);
    const l = () => setOn(m.matches);
    m.addEventListener('change', l);
    return () => m.removeEventListener('change', l);
  }, []);
  return on;
}

export function LpList({ lps, selected, onOpen }: { lps: LpRow[]; selected?: string; onOpen: (id: string) => void }) {
  const desk = useDesktop();
  return (
    <div className="list">
      {lps.map((l) => (
        <button key={l.id} type="button" className={'row lp-row' + (selected === l.id ? ' active' : '')} aria-current={selected === l.id ? 'true' : undefined} onClick={() => onOpen(l.id)}>
          <div className="stack grow" style={{ gap: 3 }}>
            <span className="lp-name">{l.name}</span>
            <span className="lp-sub">{plural(l.storyCount, 'story', 'stories')} · {desk ? l.questionCount + ' q' : plural(l.questionCount, 'question')} · {agoLabel(l.lastAt)}</span>
          </div>
          <VerdictChip code={l.verdict} />
          <Icon.Forward size={16} className="lp-chev" />
        </button>
      ))}
      {lps.length === 0 && <div className="row sub empty-row">No areas yet — import a CSV of your own, or load the AWS defaults.</div>}
    </div>
  );
}

export function StoryCards({ stories, selected, onOpen }: { stories: StoryRow[]; selected?: string; onOpen: (id: string) => void }) {
  return (
    <div className="story-cards">
      {stories.map((s) => (
        <button key={s.id} type="button" className={'story-card' + (selected === s.id ? ' active' : '')} aria-current={selected === s.id ? 'true' : undefined} onClick={() => onOpen(s.id)}>
          <div className="hstack between" style={{ width: '100%', gap: 10 }}><span className="st-title">{s.title}</span><VerdictChip code={s.best} /></div>
          {s.summary && <span className="st-sum">{s.summary}</span>}
          {s.numbers.length > 0 && <div className="hstack wrap" style={{ gap: 6 }}>{s.numbers.map((n, i) => <span key={i} className="num">{n.label ? n.label + ' ' + n.value : n.value}</span>)}</div>}
          <div className="hstack wrap" style={{ gap: 6, width: '100%' }}>
            {s.lpShorts.map((t, i) => <span key={i} className="st-short">{t}</span>)}
            {s.lpShorts.length === 0 && <span className="is-none">not mapped yet</span>}
            <span className={'st-uses' + (s.overused ? ' over' : '')}>used {s.uses}×</span>
          </div>
        </button>
      ))}
      {stories.length === 0 && <div className="card pad sub" style={{ textAlign: 'center', padding: 20 }}>No stories yet. Add one, or import a markdown file with one <span className="mono">## heading</span> per story.</div>}
    </div>
  );
}

export function QuestionList({ questions, lps, more, onMore, onAsk, onAnswer, onRetag }: { questions: QuestionRow[]; lps: Lp[]; more: boolean; onMore: () => void; onAsk: (q: QuestionRow) => void; onAnswer: (q: QuestionRow) => void; onRetag: (id: string, lpId: string) => void }) {
  const [retag, setRetag] = useState<string | null>(null);
  return (
    <div className="list">
      {questions.map((q) => {
        const lpId = q.lpIds[0] ?? '';
        return (
          <div key={q.id} className="q-row">
            <button type="button" className="q-text" title="Ask me this now" onClick={() => onAsk(q)}>{q.text}</button>
            <div className="q-line">
              {retag === q.id
                ? <select className="input lp-select" autoFocus aria-label="Leadership Principle" value={lpId} onBlur={() => setRetag(null)} onChange={(e) => { onRetag(q.id, e.target.value); setRetag(null); }}>
                    <option value="">Untagged</option>{lps.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                : <button type="button" className={'lp-tag' + (lpId ? '' : ' gold')} title="Change the area" onClick={() => setRetag(q.id)}>{q.lpName}</button>}
              <span className="q-meta">{q.sourceLabel} · {q.diffLabel} · {q.askedLabel}{q.tags ? ' · ' + q.tags : ''}</span>
              <span className="q-right">
                <button type="button" className="star-btn" aria-label="Model answer" title="✦ Model answer" onClick={() => onAnswer(q)}>✦</button>
                <VerdictChip code={q.lastVerdict} />
              </span>
            </div>
          </div>
        );
      })}
      {questions.length === 0 && <div className="row sub empty-row">No questions match this filter.</div>}
      {more && <button type="button" className="show-more" onClick={onMore}>Show more</button>}
    </div>
  );
}

export function FileList({ files, onOpen, onToggle }: { files: PrepFile[]; onOpen: (id: string) => void; onToggle: (id: string, on: boolean) => void }) {
  return (
    <div className="list">
      {files.map((f) => (
        <div key={f.id} className="row file-row">
          <span className="file-ic"><FileIcon /></span>
          <button type="button" className="file-main" onClick={() => onOpen(f.id)}>
            <span className="file-name">{f.name}</span>
            <div className="hstack" style={{ gap: 6 }}><span className="type-chip">{f.type}</span><span className="q-meta">{fmtSize(f.size)} · {fmtDay(f.updatedAt)}</span></div>
          </button>
          <Switch checked={f.included} label={'Include ' + f.name + ' in prep'} onChange={(on) => onToggle(f.id, on)} />
        </div>
      ))}
      {files.length === 0 && <div className="row sub empty-row">No files yet. Drop your JD, background and past-loop notes above.</div>}
    </div>
  );
}

// ---------- Question filters ----------

interface FilterChipProps { label: string; value: string; options?: { value: string; label: string }[]; onChange: (v: string) => void; current?: string }
/** A filter pill: a dropdown (native select laid over the pill) when it has options, a toggle otherwise; set → ink with ✕. */
function FilterChip({ label, value, options, onChange, current }: FilterChipProps) {
  const on = !!value;
  if (!options) return <button type="button" className={'fchip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => onChange(on ? '' : '1')}>{label}</button>;
  return (
    <span className={'fchip' + (on ? ' on clearable' : '')}>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{label} · any</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span>{on ? current ?? label : label}</span>
      {on ? <button type="button" className="x" aria-label={'Clear ' + label} onClick={() => onChange('')}>✕</button> : <span className="caret">▾</span>}
    </span>
  );
}

interface Filters { lp: string; source: string; difficulty: string; notAsked: string; verdict: string; amazon: string; untagged: string }
const NO_FILTERS: Filters = { lp: '', source: '', difficulty: '', notAsked: '', verdict: '', amazon: '', untagged: '' };

export function applyFilters(rows: QuestionRow[], f: Filters): QuestionRow[] {
  return rows.filter((q) =>
    (!f.lp || q.lpIds.includes(f.lp)) && (!f.source || q.source === f.source) && (!f.difficulty || String(q.difficulty) === f.difficulty)
    && (!f.notAsked || q.timesAsked === 0) && (!f.verdict || (f.verdict === 'none' ? !q.lastVerdict : q.lastVerdict === f.verdict))
    && (!f.amazon || /amazon|aws/i.test(q.tags)) && (!f.untagged || q.lpIds.length === 0));
}

// ---------- Screen ----------

interface Importing { pct: number; msg: string }

export default function Library({ seg }: { seg: LibrarySeg }) {
  const { data, repo, refresh, go, route, toast, live, openSheet, dbMode, gemini } = useApp();
  const { lpRows, storyRows, questionRows, files, covered, lps } = data;
  const selected = route.parts[2];

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [limit, setLimit] = useState(PAGE);
  const [importing, setImporting] = useState<Importing | null>(null);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [storyImport, setStoryImport] = useState<{ fileName: string; stories: ParsedStory[] } | null>(null);
  const bankInput = useRef<HTMLInputElement>(null);
  const storyInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const areaInput = useRef<HTMLInputElement>(null);

  useEffect(() => { setLimit(PAGE); }, [filters, seg]);

  // ---- imports
  /** With a key and a connection, Gemini re-tags the rows the keyword tagger is unsure of. */
  const geminiTags = useCallback(async (rows: ParsedQuestion[]): Promise<ParsedQuestion[]> => {
    if (!gemini.hasKey || !rows.some((r) => !(r.lpId && r.confidence === 'high'))) return rows;
    setImporting({ pct: 100, msg: 'Tagging with Gemini…' });
    const r = await tagWithGemini(rows, lps, { key: gemini.key, model: data.settings.textModel });
    setImporting(null);
    if (r.error) toast('Gemini tagging failed — keyword tags kept · ' + r.error);
    return r.rows;
  }, [gemini.hasKey, gemini.key, lps, data.settings.textModel, toast]);
  /** Parse picked/dropped files into a review; `keep` also files them under Files. */
  const importFiles = useCallback(async (list: File[], keep: boolean) => {
    const rows: ParsedQuestion[] = [];
    const names: string[] = [];
    let kept = 0, source: QuestionSource = 'custom';
    setImporting({ pct: 0, msg: 'Reading ' + list[0].name + '…' });
    for (const [i, f] of list.entries()) {
      const kind = fileKind(f.name);
      let text: string;
      try { text = await fileText(f); } catch { toast(f.name + ' could not be read'); continue; }
      setImporting({ pct: Math.round(((i + 0.5) / list.length) * 100), msg: 'Scanning ' + f.name + '…' });
      await tick();
      let found: ParsedQuestion[];
      if (kind === 'csv') found = parseQuestionsFromCsv(text, lps);
      else if (kind === 'json' || kind === 'zst') { found = parseExponentRows(text, lps) ?? parsedQuestionsFromText(text, 'custom', lps); if (found.length) source = 'common'; }
      else {
        const type = detectFileType(text);
        const src: QuestionSource = type === 'Past interviews' ? 'previous' : 'custom';
        if (src === 'previous') source = 'previous';
        if (keep) {
          const now = new Date().toISOString();
          const existing = files.find((x) => x.name === f.name);
          await repo.upsertFile({ id: existing?.id ?? newId('f'), name: f.name, type, content: text, included: true, size: f.size || text.length, updatedAt: now, summary: null });
          kept++;
        }
        found = parsedQuestionsFromText(text, src, lps);
      }
      for (const r of found) if (!rows.some((x) => x.text === r.text)) rows.push(r);
      names.push(f.name);
      setImporting({ pct: Math.round(((i + 1) / list.length) * 100), msg: 'Scanned ' + f.name + ' · ' + plural(rows.length, 'question') });
    }
    await tick();
    setImporting(null);
    if (kept) { await refresh(); toast('Added ' + plural(kept, 'file') + ' · type detected from content'); }
    if (!names.length) return;
    if (!rows.length) { if (!kept) toast('No questions found in ' + names.join(', ')); return; }
    const fileName = names.length === 1 ? names[0] : names[0] + ' + ' + (names.length - 1) + ' more';
    setReview(prepareReview(await geminiTags(rows), { fileName, source, existing: data.questions }));
  }, [data.questions, files, lps, refresh, repo, toast, geminiTags]);

  const importStoryFiles = useCallback(async (list: File[]) => {
    const all: ParsedStory[] = [];
    for (const f of list) all.push(...parseStoriesFile(f.name, await f.text(), lps));
    if (!all.length) { toast('No stories found in ' + list.map((f) => f.name).join(', ') + ' — start from the sample CSV'); return; }
    setStoryImport({ fileName: list.length === 1 ? list[0].name : list[0].name + ' + ' + (list.length - 1) + ' more', stories: all });
  }, [lps, toast]);

  // FilePreview's "Import N questions": #/library/questions?import=<fileId>. Opened once per file
  // id, and only when that file is loaded (a cold load on this URL arrives before the data does).
  const importParam = route.query.get('import');
  const importHandled = useRef<string | null>(null);
  useEffect(() => {
    if (!importParam) { importHandled.current = null; return; }
    if (importHandled.current === importParam) return;
    const f = files.find((x) => x.id === importParam);
    if (!f) return;
    importHandled.current = importParam;
    const src: QuestionSource = f.type === 'Past interviews' ? 'previous' : 'custom';
    const rows = parsedQuestionsFromText(f.content, src, lps);
    if (!rows.length) { toast('No questions found in ' + f.name); go(paths.library('questions'), true); return; }
    void geminiTags(rows).then((tagged) => setReview(prepareReview(tagged, { fileName: f.name, source: src, existing: data.questions })));
  }, [importParam, files, lps, data.questions, go, toast, geminiTags]);
  const closeReview = () => { setReview(null); if (importParam) go(paths.library('questions'), true); };

  // ---- actions
  const resetLps = async () => { if (!confirm('Replace the areas with the 16 AWS Leadership Principles?')) return; await repo.resetLps(); await refresh(); toast('Areas set to the AWS Leadership Principles'); };
  const importAreas = async (f: File) => {
    const text = await f.text();
    const parsed = csvKind(text) === 'areas' ? parseAreasFromCsv(text) : [];
    if (!parsed.length) { toast('No areas found in ' + f.name + ' — start from the sample CSV'); return; }
    if (lps.length && !confirm('Replace the ' + plural(lps.length, 'area') + ' with the ' + plural(parsed.length, 'area') + ' in ' + f.name + '? Matching names keep their stories and questions.')) return;
    await repo.setLps(areasFromParsed(parsed, lps)); await refresh(); toast('Areas set from ' + f.name + ' · ' + plural(parsed.length, 'area'));
  };
  const askNow = (q: QuestionRow) => { void live.start({ mode: 'question_set', focus: q.id, questionText: q.text, focusLabel: q.lpName }); };
  const retag = async (id: string, lpId: string) => { await repo.updateQuestion(id, { lpIds: lpId ? [lpId] : [] }); await refresh(); };
  const toggleFile = async (id: string, on: boolean) => { await repo.setFileIncluded(id, on); await refresh(); };
  const setFilter = <K extends keyof Filters>(k: K, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  // ---- derived
  const filtered = useMemo(() => applyFilters(questionRows, filters), [questionRows, filters]);
  const shown = filtered.slice(0, limit);
  const previousCount = filtered.filter((q) => q.source === 'previous').length;
  const includedCount = files.filter((f) => f.included).length;
  const gaps = lps.length - covered.size;
  const dbBadge = dbMode === 'duckdb' ? 'DuckDB-WASM ✓' : dbMode === 'memory' ? 'in-memory library' : 'starting';
  const lpOptions = lps.map((l) => ({ value: l.id, label: l.name }));
  const sourceOptions = (Object.keys(SOURCE_LABEL) as QuestionSource[]).map((s) => ({ value: s, label: SOURCE_LABEL[s] }));
  const verdictOptions = [...(Object.keys(VERDICT_LABEL) as Verdict[]).map((v) => ({ value: v, label: VERDICT_LABEL[v] })), { value: 'none', label: 'Not yet' }];
  const lpById = (id: string): string => lps.find((l) => l.id === id)?.name ?? id;

  if (review) return <ImportReview review={review} onCancel={closeReview} onSaved={() => { closeReview(); if (seg !== 'questions') go(paths.library('questions')); }} />;

  const actions = (
    <div className="lib-actions">
      {seg === 'lps' && (
        <>
          <button type="button" className="btn hd quiet" onClick={() => downloadTemplate('areas')} title="Download a sample areas CSV to fill in">Sample CSV</button>
          <button type="button" className="btn hd" onClick={() => areaInput.current?.click()}><Icon.Upload size={16} />Import CSV</button>
          <button type="button" className="btn hd quiet" onClick={() => void resetLps()}>AWS defaults</button>
        </>
      )}
      {seg === 'stories' && (
        <>
          <button type="button" className="btn hd" onClick={() => go(paths.grid)}><span className="phone-only">Grid</span><span className="desk-only">Story × area grid</span></button>
          <button type="button" className="btn hd" onClick={() => storyInput.current?.click()}><span className="phone-only">Import</span><span className="desk-only">Import CSV</span></button>
          <button type="button" className="btn hd quiet" onClick={() => downloadTemplate('stories')} title="Download a sample stories CSV to fill in">Sample CSV</button>
          <button type="button" className="btn hd ink" onClick={() => openSheet('addStory')}>+ Story</button>
        </>
      )}
      {seg === 'questions' && (
        <>
          <button type="button" className="btn hd" onClick={() => bankInput.current?.click()} disabled={!!importing}><Icon.Upload size={16} />Upload</button>
          <button type="button" className="btn hd quiet" onClick={() => downloadTemplate('questions')} title="Download a sample questions CSV to fill in">Sample CSV</button>
          <button type="button" className="btn hd ink" onClick={() => openSheet('addQuestion')}>+ Question</button>
        </>
      )}
      {seg === 'files' && <span className="lib-note">{includedCount} of {files.length} included in prep</span>}
    </div>
  );
  const head = (
    <div className="screen-head column">
      <div className="hstack between">
        <span className="h1"><span className="lib-title-phone">Library</span><span className="lib-title-desk">{SEG_LABEL[seg]}</span></span>
        {actions}
      </div>
      <Seg<LibrarySeg> className="phone-only" value={seg} onChange={(s) => go(paths.library(s))} options={[['lps', 'Areas'], ['stories', 'Stories'], ['questions', 'Questions'], ['files', 'Files']]} />
    </div>
  );

  const pickers = (
    <>
      <input ref={bankInput} type="file" multiple accept=".md,.txt,.csv,.json,.zst" style={{ display: 'none' }} aria-hidden="true" onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ''; if (l.length) void importFiles(l, false); }} />
      <input ref={areaInput} type="file" accept=".csv" style={{ display: 'none' }} aria-hidden="true" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importAreas(f); }} />
      <input ref={storyInput} type="file" multiple accept=".csv" style={{ display: 'none' }} aria-hidden="true" onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ''; if (l.length) void importStoryFiles(l); }} />
      <input ref={folderInput} type="file" multiple style={{ display: 'none' }} aria-hidden="true" {...({ webkitdirectory: '' } as Record<string, string>)} onChange={(e) => { const l = Array.from(e.target.files ?? []).filter((f) => /\.(md|txt|csv)$/i.test(f.name)); e.target.value = ''; if (l.length) void importFiles(l, true); else toast('No .md, .txt or .csv files in that folder'); }} />
      {storyImport && <ImportStories open fileName={storyImport.fileName} stories={storyImport.stories} onClose={() => setStoryImport(null)} />}
    </>
  );

  if (seg === 'lps') {
    return (
      <div className="screen">
        <div className="lib-md">
          <div className="lib-master">
            {head}
            <div className="screen-body">
              <LpList lps={lpRows} selected={selected} onOpen={(id) => go(paths.lp(id))} />
              <span className="lib-foot">{dbBadge}</span>
            </div>
          </div>
          <div className="lib-detail" aria-hidden="true">
            <span style={{ font: '700 15px/1.2 var(--font-sans)', color: 'var(--m-fg2)' }}>Pick a Leadership Principle</span>
            <span className="sub">Its stories, question bank, verdict history and best attempt open here.</span>
          </div>
        </div>
        {pickers}
      </div>
    );
  }

  return (
    <div className="screen">
      {head}
      <div className="screen-body">
        {seg === 'stories' && (
          <>
            <div className="hstack between">
              <span className="q-count">{plural(storyRows.length, 'story', 'stories')} · <span className="mono">{covered.size}/{lps.length}</span> areas covered</span>
              {gaps > 0 ? <button type="button" className="gaps-btn" onClick={() => go(paths.grid)}>{plural(gaps, 'gap')}</button> : <span className="q-count" style={{ color: 'var(--m-green)' }}>every area covered</span>}
            </div>
            <StoryCards stories={storyRows} selected={selected} onOpen={(id) => go(paths.story(id))} />
          </>
        )}

        {seg === 'questions' && (
          <>
            <div className="filter-row" role="group" aria-label="Filters">
              <FilterChip label="Area" value={filters.lp} options={lpOptions} current={filters.lp ? lpById(filters.lp) : undefined} onChange={(v) => setFilter('lp', v)} />
              <FilterChip label="Source" value={filters.source} options={sourceOptions} current={filters.source ? SOURCE_LABEL[filters.source as QuestionSource] : undefined} onChange={(v) => setFilter('source', v)} />
              <FilterChip label="Difficulty" value={filters.difficulty} options={[{ value: '1', label: 'Easy' }, { value: '2', label: 'Medium' }, { value: '3', label: 'Hard' }]} current={['', 'Easy', 'Medium', 'Hard'][Number(filters.difficulty)]} onChange={(v) => setFilter('difficulty', v)} />
              <FilterChip label="Not asked" value={filters.notAsked} onChange={(v) => setFilter('notAsked', v)} />
              <FilterChip label="Last verdict" value={filters.verdict} options={verdictOptions} current={filters.verdict ? verdictOptions.find((o) => o.value === filters.verdict)?.label : undefined} onChange={(v) => setFilter('verdict', v)} />
              <FilterChip label="Asked at Amazon" value={filters.amazon} onChange={(v) => setFilter('amazon', v)} />
              <FilterChip label="Untagged" value={filters.untagged} onChange={(v) => setFilter('untagged', v)} />
            </div>
            <span className="q-count" style={{ flex: 'none' }}>{plural(filtered.length, 'question')} · {previousCount} from previous interviews</span>
            {importing && (
              <div className="import-bar" role="status">
                <div className="ib-line"><span>{importing.msg}</span><span className="mono">{importing.pct}%</span></div>
                <div className="ib-track"><span style={{ width: importing.pct + '%' }} /></div>
              </div>
            )}
            <QuestionList questions={shown} lps={lps} more={filtered.length > shown.length} onMore={() => setLimit((n) => n + PAGE)} onAsk={askNow} onAnswer={(q) => openSheet('answer', q)} onRetag={(id, lp) => void retag(id, lp)} />
            <div className="hstack between wrap" style={{ gap: 8 }}>
              <span className="lib-foot grow">Tap a question to ask it now · ✦ model answer · tap the area chip to retag</span>
              {/* Plan D4: the 18 MB export is not bundled; this opens the same picker as Upload. */}
              <button type="button" className="btn xs ink" onClick={() => bankInput.current?.click()} disabled={!!importing}>Load full Exponent export</button>
            </div>
          </>
        )}

        {seg === 'files' && (
          <>
            <Dropzone id="lib-files" accept=".md,.txt,.csv" multiple onFiles={(l) => void importFiles(l, true)}
              title={<><span className="drop-ic"><Icon.Upload size={20} /></span>Drop markdown here</>}
              sub={<>JD, background, notes from past loops. <span className="drop-link">Browse</span></>} />
            <button type="button" className="btn sm folder-btn" style={{ alignSelf: 'flex-start' }} onClick={() => folderInput.current?.click()}>Add a folder</button>
            {importing && (
              <div className="import-bar" role="status">
                <div className="ib-line"><span>{importing.msg}</span><span className="mono">{importing.pct}%</span></div>
                <div className="ib-track"><span style={{ width: importing.pct + '%' }} /></div>
              </div>
            )}
            <FileList files={files} onOpen={(id) => go(paths.file(id))} onToggle={(id, on) => void toggleFile(id, on)} />
            <span className="lib-foot">Dropping is the whole action: type detected from content, included by default. Toggle off only what’s stale.</span>
          </>
        )}
      </div>
      {pickers}
    </div>
  );
}

