// Story editor (board 3 · "Story editor · Payments outage"): Title, Situation / Task / Action /
// Result / Learning, key numbers as mono pills (✕ removes, tap edits, "+ number" adds a
// label + value row), LP mapping rows with a Primary / Secondary mini-seg (tap the active role
// again to unmap; "+ Map another LP" shows the unmapped LPs), Save (repo.upsertStory), Delete
// (asks once, inline), and "Pressure-test this story" → live.start({ mode: 'story' }).

import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { BackHead, Icon, Input } from '../components/ui.tsx';
import type { KeyNumber, LpRole, Story } from '../domain/types.ts';
import type { StoryRow } from '../domain/selectors.ts';
import '../styles/screens/library-detail.css';

type TextField = 'title' | 'summary' | 'situation' | 'task' | 'action' | 'result' | 'learning';
interface Draft { title: string; summary: string; situation: string; task: string; action: string; result: string; learning: string; numbers: KeyNumber[] }
const TEXT_FIELDS: TextField[] = ['title', 'summary', 'situation', 'task', 'action', 'result', 'learning'];
const STAR: [Exclude<TextField, 'title' | 'summary'>, string, number, string][] = [
  ['situation', 'Situation', 112, 'Where and when; what was at stake.'],
  ['task', 'Task', 112, 'What you, specifically, had to do.'],
  ['action', 'Action', 112, 'What you did — “I”, not “we”.'],
  ['result', 'Result', 112, 'The outcome, with the numbers.'],
  ['learning', 'Learning', 88, 'What you would do differently.'],
];

const fromStory = (s: Story): Draft => ({ title: s.title, summary: s.summary, situation: s.situation, task: s.task, action: s.action, result: s.result, learning: s.learning, numbers: s.numbers.map((n) => ({ ...n })) });
const sameNumbers = (a: KeyNumber[], b: KeyNumber[]): boolean => a.length === b.length && a.every((n, i) => n.label === b[i].label && n.value === b[i].value);
const numberText = (n: KeyNumber): string => (n.label ? n.label + ' ' + n.value : n.value);

export default function StoryEditor({ id }: { id: string }) {
  const { data, repo, refresh, go, toast, live } = useApp();
  const story: StoryRow | undefined = data.storyRows.find((s) => s.id === id);
  const lps = data.lps;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [numEdit, setNumEdit] = useState<{ index: number | null; label: string; value: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // A fresh draft per story; LP mapping writes refresh `story` without touching the draft.
  useEffect(() => { setDraft(story ? fromStory(story) : null); setNumEdit(null); setPicking(false); setConfirmDelete(false); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (story && !draft) setDraft(fromStory(story)); }, [story, draft]);

  const dirty = useMemo(() => !!story && !!draft && (TEXT_FIELDS.some((k) => draft[k] !== story[k]) || !sameNumbers(draft.numbers, story.numbers)), [draft, story]);
  const mapped = useMemo(() => (story ? story.links.map((k) => ({ lp: lps.find((l) => l.id === k.lpId), role: k.role })).filter((m) => !!m.lp).map((m) => ({ lp: m.lp!, role: m.role })) : []), [story, lps]);
  const unmapped = useMemo(() => (story ? lps.filter((l) => !story.links.some((k) => k.lpId === l.id)) : []), [story, lps]);

  if (!story || !draft) {
    return (
      <div className="screen">
        <BackHead onBack={() => go(paths.library('stories'))} label="Stories" />
        <div className="screen-body"><div className="card pad sub">That story is not in your library any more.</div></div>
      </div>
    );
  }

  const set = (k: TextField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft((d) => (d ? { ...d, [k]: e.target.value } : d));

  const save = async (): Promise<boolean> => {
    const title = draft.title.trim();
    if (!title) { toast('Give the story a title'); return false; }
    setBusy(true);
    const fresh = (await repo.story(id)) ?? story;
    const next: Story = { ...fresh, title, summary: draft.summary.trim(), situation: draft.situation, task: draft.task, action: draft.action, result: draft.result, learning: draft.learning, numbers: draft.numbers.filter((n) => n.value.trim()), updatedAt: new Date().toISOString() };
    await repo.upsertStory(next);
    await refresh();
    setDraft(fromStory(next));
    setBusy(false);
    toast('Saved ' + title);
    return true;
  };
  const setRole = async (lpId: string, role: LpRole | null) => {
    await repo.setStoryLp(id, lpId, role); await refresh();
    const name = lps.find((l) => l.id === lpId)?.name ?? lpId;
    toast(role ? name + ' · ' + role : 'Unmapped from ' + name);
  };
  const mapAnother = async (lpId: string) => { setPicking(false); await setRole(lpId, story.links.some((k) => k.role === 'primary') ? 'secondary' : 'primary'); };
  const remove = async () => {
    setBusy(true);
    await repo.deleteStory(id); await refresh();
    toast('Deleted “' + story.title + '”');
    go(paths.library('stories'), true);
  };
  const pressureTest = async () => {
    if (dirty && !(await save())) return;
    void live.start({ mode: 'story', focus: id, focusLabel: draft.title.trim() || story.title });
  };

  // ---- key numbers
  const commitNumber = () => {
    if (!numEdit || !numEdit.value.trim()) return;
    const n: KeyNumber = { label: numEdit.label.trim(), value: numEdit.value.trim() };
    setDraft((d) => d ? { ...d, numbers: numEdit.index == null ? [...d.numbers, n] : d.numbers.map((x, i) => (i === numEdit.index ? n : x)) } : d);
    setNumEdit(null);
  };
  const removeNumber = (i: number) => { setDraft((d) => (d ? { ...d, numbers: d.numbers.filter((_, j) => j !== i) } : d)); if (numEdit?.index === i) setNumEdit(null); };

  const saveButton = <button type="button" className="se-save" disabled={!dirty || busy} onClick={() => void save()}>{dirty ? 'Save' : 'Saved'}</button>;

  return (
    <div className="screen">
      <BackHead onBack={() => go(paths.library('stories'))} label="Stories" right={saveButton} />
      <div className="screen-body se-body">
        <Input label="Title" value={draft.title} onChange={set('title')} placeholder="Payments outage" />
        <Input label="One-line summary" value={draft.summary} onChange={set('summary')} placeholder="What happened, in one sentence — shown on the story card." />
        {STAR.map(([k, label, h, ph]) => <Input key={k} label={label} multiline value={draft[k]} onChange={set(k)} placeholder={ph} style={{ minHeight: h }} rows={4} />)}

        {/* ---- key numbers */}
        <div className="stack g8">
          <span className="se-h">Key numbers</span>
          <div className="se-nums">
            {draft.numbers.map((n, i) => (
              <span key={i} className="se-num">
                <button type="button" className="txt" title="Edit" onClick={() => setNumEdit({ index: i, label: n.label, value: n.value })}>{n.label && <span className="lbl">{n.label} </span>}{n.value}</button>
                <button type="button" className="se-num-x" aria-label={'Remove ' + numberText(n)} onClick={() => removeNumber(i)}>✕</button>
              </span>
            ))}
            <button type="button" className="se-num-add" onClick={() => setNumEdit({ index: null, label: '', value: '' })}>+ number</button>
          </div>
          {numEdit && (
            <div className="se-num-form" role="group" aria-label={numEdit.index == null ? 'New key number' : 'Edit key number'}>
              <input className="input" placeholder="Label" aria-label="Label (optional)" value={numEdit.label} onChange={(e) => setNumEdit({ ...numEdit, label: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') commitNumber(); if (e.key === 'Escape') setNumEdit(null); }} />
              <input className="input mono" placeholder="41 min to mitigate" aria-label="Value" autoFocus value={numEdit.value} onChange={(e) => setNumEdit({ ...numEdit, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') commitNumber(); if (e.key === 'Escape') setNumEdit(null); }} />
              <button type="button" className="se-num-ok" aria-label="Keep this number" disabled={!numEdit.value.trim()} onClick={commitNumber}><Icon.Check size={16} /></button>
              <button type="button" className="se-num-cancel" aria-label="Cancel" onClick={() => setNumEdit(null)}><Icon.Close size={14} /></button>
            </div>
          )}
          <span className="se-hint">Say the number before the narrative — the coach checks every one of these against what you said.</span>
        </div>

        {/* ---- LP mapping */}
        <div className="stack g8">
          <span className="se-h">LP mapping <span className="se-hint">· <button type="button" className="text-btn" style={{ color: 'var(--m-cool)', fontWeight: 700 }} onClick={() => go(paths.grid)}>tap the grid to change</button></span></span>
          <div className="list r12">
            {mapped.map(({ lp, role }) => (
              <div key={lp.id} className="se-map-row">
                <button type="button" className="se-map-name" onClick={() => go(paths.lp(lp.id))}>{lp.name}</button>
                <div className="se-role-seg" role="group" aria-label={lp.name + ' role'}>
                  {(['primary', 'secondary'] as LpRole[]).map((r) => (
                    <button key={r} type="button" className={r + (role === r ? ' on' : '')} aria-pressed={role === r} title={role === r ? 'Tap again to unmap' : 'Make it ' + r} onClick={() => void setRole(lp.id, role === r ? null : r)}>{r}</button>
                  ))}
                </div>
              </div>
            ))}
            {mapped.length === 0 && <div className="lpd-empty">Not mapped to any LP yet — the interviewer will not reach for this story.</div>}
            <button type="button" className={'se-map-add' + (picking ? ' open' : '')} aria-expanded={picking} onClick={() => setPicking((p) => !p)}>{picking ? 'Pick an LP' : '+ Map another LP'}</button>
            {picking && (
              <div className="se-pick" role="group" aria-label="Unmapped LPs">
                {unmapped.map((l) => <button key={l.id} type="button" title={l.name} onClick={() => void mapAnother(l.id)}>{l.short} · {l.name}</button>)}
                {unmapped.length === 0 && <span className="se-hint">Every LP is mapped to this story.</span>}
              </div>
            )}
          </div>
          <span className="se-hint">Used {story.uses}× in sessions{story.overused ? ' — over-used; a loop will notice' : ''}.</span>
        </div>

        {/* ---- delete */}
        <div className="se-del">
          {confirmDelete ? (
            <>
              <span className="q">Delete “{story.title}” for good?</span>
              <button type="button" className="btn xs danger" disabled={busy} onClick={() => void remove()}>Delete</button>
              <button type="button" className="btn xs ghost" onClick={() => setConfirmDelete(false)}>Keep it</button>
            </>
          ) : <button type="button" className="btn ghost danger sm" style={{ paddingLeft: 0 }} onClick={() => setConfirmDelete(true)}>Delete story</button>}
        </div>
      </div>
      <div className="screen-foot se-foot">
        {dirty && <button type="button" className="btn lg" disabled={busy} onClick={() => void save()}>Save</button>}
        <button type="button" className="btn lg primary" disabled={busy} onClick={() => void pressureTest()}>Pressure-test this story</button>
      </div>
    </div>
  );
}
