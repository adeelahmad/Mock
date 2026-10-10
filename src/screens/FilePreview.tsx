// File preview / editor (board 3 · "File preview" and "File editor"): Preview renders the
// markdown (headings, paragraphs, lists, bold / italic / code, quotes — strings only, no raw
// HTML), the type chip, the "Mock found · N questions · N verdict hints · N story reference"
// box, "Import N questions" (repo.addQuestions, keyword-tagged, source 'previous' for past
// interviews) and "Replay this loop" (live.start mode 'replay'). Edit is a mono textarea that
// saves on blur ("Saved · just now") with Done; Remove file deletes it.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { BackHead, Seg, Switch } from '../components/ui.tsx';
import { newId } from '../db/repo.ts';
import type { PrepFile, Question, QuestionSource, Story } from '../domain/types.ts';
import { guessLp, parseQuestionsFromText } from '../domain/parsers.ts';
import '../styles/screens/library-detail.css';

// ---------- a small, safe markdown → React renderer ----------

export type MdBlock =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'pre'; text: string }
  | { t: 'quote'; text: string }
  | { t: 'hr' };

const UL = /^\s*[-*+•]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const BLOCK_START = /^(#{1,6}\s|\s*```|\s*[-*+•]\s|\s*\d+[.)]\s|\s*>)/;

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const buf: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push({ t: 'pre', text: buf.join('\n') }); continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { out.push({ t: 'h', level: h[1].length, text: h[2] }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ t: 'hr' }); i++; continue; }
    if (UL.test(line) || OL.test(line)) {
      const re = OL.test(line) && !UL.test(line) ? OL : UL;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(re.exec(lines[i])![1]); i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !re.test(lines[i])) { items[items.length - 1] += ' ' + lines[i].trim(); i++; }
      }
      out.push({ t: re === OL ? 'ol' : 'ul', items }); continue;
    }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', text: buf.join(' ') }); continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) buf.push(lines[i++].trim());
    if (!buf.length) { buf.push(lines[i].trim()); i++; }
    out.push({ t: 'p', text: buf.join(' ') });
  }
  return out;
}

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\s][^*\n]*\*|(?<![A-Za-z0-9])_[^_\s][^_\n]*_(?![A-Za-z0-9])|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/;

/** Inline markdown → React nodes: bold, italic, code, http(s) links. Text stays text. */
export function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rest = text, k = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) { nodes.push(rest); break; }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const tok = m[0];
    if (tok.startsWith('**') || tok.startsWith('__')) nodes.push(<strong key={k++}>{renderInline(tok.slice(2, -2))}</strong>);
    else if (tok.startsWith('`')) nodes.push(<code key={k++} className="md-code">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('[')) { const l = /^\[([^\]]+)\]\((.+)\)$/.exec(tok)!; nodes.push(<a key={k++} href={l[2]} target="_blank" rel="noopener noreferrer">{renderInline(l[1])}</a>); }
    else nodes.push(<em key={k++}>{renderInline(tok.slice(1, -1))}</em>);
    rest = rest.slice(m.index + tok.length);
  }
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h': { const cls = b.level === 1 ? 'md-h1' : b.level === 2 ? 'md-h2' : 'md-h3'; const Tag = ('h' + Math.min(b.level, 6)) as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'; return <Tag key={i} className={cls}>{renderInline(b.text)}</Tag>; }
          case 'p': return <p key={i} className="md-p">{renderInline(b.text)}</p>;
          case 'ul': return <ul key={i} className="md-ul">{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>;
          case 'ol': return <ol key={i} className="md-ol">{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ol>;
          case 'pre': return <pre key={i} className="md-pre">{b.text}</pre>;
          case 'quote': return <blockquote key={i} className="md-quote">{renderInline(b.text)}</blockquote>;
          case 'hr': return <hr key={i} className="md-hr" />;
        }
      })}
    </>
  );
}

// ---------- what Mock finds in a file ----------

const VERDICT_HINT = /\b(strong hire|no hire|not inclined|inclined|no offer|offer extended|got the offer)\b/i;
const STOP = new Set(['under', 'about', 'their', 'there', 'these', 'those', 'where', 'which', 'while', 'after', 'before', 'story', 'stories']);

/** Story titles referenced in the text: the full title, or a distinctive title word (≥ 6 letters). */
export function storyReferences(text: string, stories: Pick<Story, 'id' | 'title'>[]): string[] {
  const low = text.toLowerCase();
  return stories.filter((s) => {
    const t = s.title.toLowerCase();
    if (t && low.includes(t)) return true;
    return t.split(/[^a-z0-9]+/).filter((w) => w.length >= 6 && !STOP.has(w)).some((w) => new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(low));
  }).map((s) => s.id);
}

export interface Found { questions: string[]; verdictHints: number; storyRefs: string[] }
export function scanFile(content: string, stories: Pick<Story, 'id' | 'title'>[]): Found {
  return { questions: parseQuestionsFromText(content), verdictHints: content.split(/\r?\n/).filter((l) => VERDICT_HINT.test(l)).length, storyRefs: storyReferences(content, stories) };
}

const plural = (n: number, one: string, many = one + 's'): string => n + ' ' + (n === 1 ? one : many);
const byteSize = (s: string): number => new TextEncoder().encode(s).length;
const savedLabel = (iso: string | null, now = Date.now()): string => {
  if (!iso) return 'Saved';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return 'Saved';
  if (s < 45) return 'Saved · just now';
  if (s < 3600) return 'Saved · ' + Math.round(s / 60) + ' min ago';
  if (s < 86400) return 'Saved · ' + Math.round(s / 3600) + ' h ago';
  return 'Saved · ' + Math.round(s / 86400) + ' d ago';
};
const EMPTY_COPY = 'No content stored for this sample file. Files you drop keep their full text and are sent to the interviewer when included.';

// ---------- screen ----------

export default function FilePreview({ id }: { id: string }) {
  const { data, repo, refresh, go, toast, live } = useApp();
  const file: PrepFile | undefined = data.files.find((f) => f.id === id);
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setMode('preview'); setDirty(false); setConfirmRemove(false); setSavedAt(file?.updatedAt ?? null); setText(file?.content ?? ''); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode !== 'edit') return; const t = setInterval(() => setTick((x) => x + 1), 15000); return () => clearInterval(t); }, [mode]);
  void tick;

  const found = useMemo(() => scanFile(file?.content ?? '', data.stories), [file?.content, data.stories]);

  if (!file) {
    return (
      <div className="screen">
        <BackHead onBack={() => go(paths.library('files'))} label="Files" />
        <div className="screen-body"><div className="card pad sub">That file is not in your library any more.</div></div>
      </div>
    );
  }

  const save = async () => {
    if (!dirty) return;
    const now = new Date().toISOString();
    await repo.upsertFile({ ...file, content: text, size: byteSize(text), updatedAt: now });
    await refresh();
    setDirty(false); setSavedAt(now);
  };
  const openEdit = () => { setText(file.content); setDirty(false); setMode('edit'); setTimeout(() => editor.current?.focus(), 0); };
  const done = async () => { await save(); setMode('preview'); };
  const importQuestions = async () => {
    const source: QuestionSource = file.type === 'Past interviews' ? 'previous' : 'custom';
    const now = new Date().toISOString();
    const rows: Question[] = found.questions.map((t) => {
      const g = guessLp(t, data.lps);
      return { id: newId('q'), text: t, lpIds: g.lpId ? [g.lpId] : [], source, difficulty: 2, timesAsked: 0, lastVerdict: null, bestExchangeId: null, tags: '', votes: 0, sample: '', createdAt: now };
    });
    const added = await repo.addQuestions(rows);
    await refresh();
    const untagged = rows.filter((r) => !r.lpIds.length).length;
    toast(added ? 'Added ' + plural(added, 'question') + ' from ' + file.name + (rows.length > added ? ' · ' + (rows.length - added) + ' already in your bank' : '') + (untagged ? ' · ' + untagged + ' left untagged' : '') : 'All ' + plural(rows.length, 'question') + ' are already in your bank');
  };
  const replay = () => { void live.start({ mode: 'replay', focus: file.id, focusLabel: file.name }); };
  const remove = async () => { await repo.deleteFile(file.id); await refresh(); toast('Removed ' + file.name); go(paths.library('files'), true); };
  const toggleIncluded = async (on: boolean) => { await repo.setFileIncluded(file.id, on); await refresh(); };

  const seg = <Seg<'preview' | 'edit'> className="fp-seg" value={mode} onChange={(m) => (m === 'edit' ? openEdit() : void done())} options={[['preview', 'Preview'], ['edit', 'Edit']]} />;
  const foundLine = plural(found.questions.length, 'question') + ' · ' + plural(found.verdictHints, 'verdict hint') + ' · ' + plural(found.storyRefs.length, 'story reference');

  return (
    <div className="screen">
      <BackHead onBack={() => go(paths.library('files'))} label="Files" right={seg} />
      <div className="screen-body fp-body">
        <div className="fp-col">
          <div className="fp-name-row">
            <span className="fp-name" title={file.name}>{file.name}</span>
            {mode === 'preview' ? <span className="fp-type">{file.type}</span> : <span className={'fp-saved' + (dirty ? ' dirty' : '')}>{dirty ? 'Editing · saves when you leave the editor' : savedLabel(savedAt)}</span>}
          </div>

          {mode === 'preview' ? (
            <div className="fp-doc" aria-label="Rendered markdown">
              {file.content.trim() ? <Markdown text={file.content} /> : <span className="md-empty">{EMPTY_COPY}</span>}
              <span className="fp-found-pad" />
              <div className="fp-found" role="status"><span className="label">Mock found</span>{foundLine}</div>
            </div>
          ) : (
            <textarea ref={editor} className="fp-editor" aria-label={'Edit ' + file.name} value={text} spellCheck={false}
              onChange={(e) => { setText(e.target.value); setDirty(true); }} onBlur={() => void save()} />
          )}

          <div className="fp-row">
            <label className="fp-incl"><Switch checked={file.included} label={'Include ' + file.name + ' in prep'} onChange={(on) => void toggleIncluded(on)} />{file.included ? 'Included in prep · sent to the interviewer' : 'Not included · kept out of the session'}</label>
            {confirmRemove ? (
              <span className="hstack" style={{ gap: 6 }}><button type="button" className="btn xs danger" onClick={() => void remove()}>Remove for good</button><button type="button" className="btn xs ghost" onClick={() => setConfirmRemove(false)}>Keep</button></span>
            ) : <button type="button" className="btn ghost danger xs" onClick={() => setConfirmRemove(true)}>Remove file</button>}
          </div>
        </div>
      </div>
      <div className="screen-foot">
        {mode === 'preview' ? (
          <div className="fp-foot-row">
            <button type="button" className="btn" disabled={!found.questions.length} title={found.questions.length ? 'Add them to the bank, tagged by keyword' : 'No questions found in this file'} onClick={() => void importQuestions()}>Import {plural(found.questions.length, 'question')}</button>
            {file.type === 'Past interviews'
              ? <button type="button" className="btn" title="Replay this loop on the live screen" onClick={replay}>Replay this loop</button>
              : <button type="button" className="btn" onClick={openEdit}>Edit</button>}
          </div>
        ) : (
          <div className="fp-foot-row"><button type="button" className="btn ink" onClick={() => void done()}>Done</button></div>
        )}
      </div>
    </div>
  );
}
