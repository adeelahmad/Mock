// Import stories (board 3): the review sheet. "stories.csv · 4 found", each row (or ## heading in
// an older markdown file) becomes a story with its STAR sections, numbers and areas;
// status per story; "Import 3 stories · skip 1 duplicate" → repo.upsertStory for each new one.

import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { Icon, Sheet } from '../components/ui.tsx';
import { newId } from '../db/repo.ts';
import type { Story } from '../domain/types.ts';
import { isNearDuplicate, type ParsedStory } from '../domain/parsers.ts';
import '../styles/screens/library.css';

export interface StoryDraft extends ParsedStory { key: string; duplicate: boolean }

/** Pure: parsed stories against the library → drafts with their duplicate flag. */
export function prepareStories(parsed: ParsedStory[], existing: Story[]): StoryDraft[] {
  return parsed.map((s, i) => ({
    ...s, key: 's' + i,
    duplicate: existing.some((e) => isNearDuplicate(e.title, s.title) || (!!s.summary && !!e.summary && isNearDuplicate(e.summary, s.summary))),
  }));
}

export default function ImportStories({ open, fileName, stories, onClose, onDone }: { open: boolean; fileName: string; stories: ParsedStory[]; onClose: () => void; onDone?: (imported: number) => void }) {
  const { data, repo, refresh, toast } = useApp();
  const lps = data.lps;
  const drafts = useMemo(() => prepareStories(stories, data.stories), [stories, data.stories]);
  /** Chosen LP ids per draft; absent = the suggestion stands. */
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [changing, setChanging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setChosen({}); setChanging(null); setBusy(false); } }, [open, stories]);

  const lpsOf = (d: StoryDraft): string[] => chosen[d.key] ?? d.suggestedLpIds;
  const lpName = (id: string): string => lps.find((l) => l.id === id)?.name ?? id;
  const fresh = drafts.filter((d) => !d.duplicate);
  const dupes = drafts.length - fresh.length;

  const toggle = (d: StoryDraft, id: string) => setChosen((c) => {
    const cur = lpsOf(d);
    return { ...c, [d.key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
  });

  const importAll = async () => {
    if (busy || !fresh.length) return;
    setBusy(true);
    const now = new Date().toISOString();
    for (const d of fresh) {
      const ids = lpsOf(d);
      const story: Story = {
        id: newId('st'), title: d.title, summary: d.summary, situation: d.situation, task: d.task, action: d.action, result: d.result, learning: d.learning,
        numbers: d.numbers, links: ids.map((lpId, i) => ({ lpId, role: i === 0 ? 'primary' : 'secondary' })), createdAt: now, updatedAt: now,
      };
      await repo.upsertStory(story);
    }
    await refresh();
    setBusy(false);
    toast('Imported ' + fresh.length + (fresh.length === 1 ? ' story' : ' stories') + (dupes ? ' · skipped ' + dupes + (dupes === 1 ? ' duplicate' : ' duplicates') : ''));
    onDone?.(fresh.length);
    onClose();
  };

  const status = (d: StoryDraft): { text: string; cls: string } =>
    d.duplicate ? { text: 'Duplicate · skip', cls: 'dup' } : d.numbers.length ? { text: 'New · ' + d.numbers.length + (d.numbers.length === 1 ? ' number found' : ' numbers found'), cls: 'new' } : { text: 'New · no numbers', cls: 'thin' };

  const head = (
    <div className="sheet-head">
      <div className="stack g2">
        <span className="label">{fileName} · {drafts.length} found</span>
        <span style={{ font: '800 24px/1.1 var(--font-sans)', letterSpacing: '-.025em' }}>Import stories</span>
      </div>
      <button type="button" className="icon-btn sm" aria-label="Close" onClick={onClose}><Icon.Close size={18} /></button>
    </div>
  );
  const foot = (
    <button type="button" className="btn lg ink block" disabled={busy || !fresh.length} onClick={() => void importAll()}>
      {busy ? 'Importing…' : fresh.length ? 'Import ' + fresh.length + (fresh.length === 1 ? ' story' : ' stories') + (dupes ? ' · skip ' + dupes + (dupes === 1 ? ' duplicate' : ' duplicates') : '') : drafts.length ? 'Nothing new to import' : 'No stories found'}
    </button>
  );

  return (
    <Sheet open={open} onClose={onClose} tall head={head} foot={foot} zIndex={12}>
      <div className="stack g10">
        <span className="is-intro">Each row becomes a story with its STAR columns and numbers; areas come from the areas column, or are suggested from the text.</span>
        {drafts.length === 0 && <span className="sub">No <code className="mono">##</code> headings in {fileName}. One heading per story, then Situation / Task / Action / Result underneath.</span>}
        {drafts.map((d) => {
          const st = status(d);
          const ids = lpsOf(d);
          return (
            <div key={d.key} className={'is-card' + (d.duplicate ? ' dup' : '')}>
              <div className="hstack between" style={{ gap: 8 }}><span className="is-title">{d.title}</span><span className={'is-status ' + st.cls}>{st.text}</span></div>
              <div className="hstack wrap" style={{ gap: 6 }}>
                <span className="is-label">Suggested</span>
                {ids.map((id) => <button key={id} type="button" className="is-chip" disabled={d.duplicate} aria-label={lpName(id) + ' · change'} onClick={() => setChanging(d.key)}>{lpName(id)}</button>)}
                {ids.length === 0 && <span className="is-none">no area yet</span>}
                {!d.duplicate && <button type="button" className="is-change" onClick={() => setChanging((c) => (c === d.key ? null : d.key))} aria-expanded={changing === d.key}>{changing === d.key ? 'Done' : 'Change'}</button>}
              </div>
              {changing === d.key && (
                <div className="hstack wrap" style={{ gap: 6 }} role="group" aria-label={'Areas for ' + d.title}>
                  {lps.map((l) => <button key={l.id} type="button" className={'is-chip' + (ids.includes(l.id) ? '' : ' off')} aria-pressed={ids.includes(l.id)} onClick={() => toggle(d, l.id)}>{l.name}</button>)}
                  <span className="is-none">first chip is the primary area</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
