// Story × LP grid (board 3 · "Story × LP grid" and "Desktop library · grid"): N of 16 covered +
// bar, "N gaps" in gold, header shorts gold where no story covers the LP, one tap on a cell
// cycles none → primary → secondary → none (repo.setStoryLp), the gap row, the legend, the
// Over-used and Gaps panels, "Import stories from markdown" (phone foot) and, on desktop, the
// Cards / grid toggle, the used ×N column, "Import markdown" and "+ Story".

import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { BackHead, Icon } from '../components/ui.tsx';
import type { Lp, LpRole } from '../domain/types.ts';
import type { StoryRow } from '../domain/selectors.ts';
import { guessLp, parseStoriesFromMarkdown, type ParsedStory } from '../domain/parsers.ts';
import ImportStories from './ImportStories.tsx';
import '../styles/screens/library-detail.css';

const roleOf = (s: StoryRow, lpId: string): LpRole | null => (s.primary.includes(lpId) ? 'primary' : s.secondary.includes(lpId) ? 'secondary' : null);
const nextRole = (r: LpRole | null): LpRole | null => (r === null ? 'primary' : r === 'primary' ? 'secondary' : null);
const joinNames = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
const plural = (n: number, one: string, many = one + 's'): string => n + ' ' + (n === 1 ? one : many);

/** Local stand-in for the coach: stories whose text the keyword tagger ranks for a gap LP. */
export function gapCandidates(stories: StoryRow[], lp: Lp): StoryRow[] {
  return stories.filter((s) => {
    const g = guessLp([s.title, s.summary, s.situation, s.task, s.action, s.result, s.learning].join(' '));
    return g.lpId === lp.id || g.alternatives.includes(lp.id);
  });
}

export default function Grid() {
  const { data, repo, refresh, go, toast, openSheet } = useApp();
  const { lps, storyRows, covered } = data;
  const [importing, setImporting] = useState<{ fileName: string; stories: ParsedStory[] } | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const total = lps.length;
  const coveredCount = lps.filter((l) => covered.has(l.id)).length;
  const gapLps = useMemo(() => lps.filter((l) => !covered.has(l.id)), [lps, covered]);
  const over = useMemo(() => storyRows.filter((s) => s.overused).sort((a, b) => b.uses - a.uses)[0] ?? null, [storyRows]);
  const overSecondaries = over ? over.secondary.map((id) => lps.find((l) => l.id === id)?.name ?? id) : [];
  const pct = total ? Math.round((coveredCount / total) * 100) : 0;

  const cycle = async (s: StoryRow, lp: Lp) => {
    const key = s.id + ':' + lp.id;
    setBusyCell(key);
    await repo.setStoryLp(s.id, lp.id, nextRole(roleOf(s, lp.id)));
    await refresh();
    setBusyCell(null);
  };
  const onFiles = async (list: File[]) => {
    const all: ParsedStory[] = [];
    for (const f of list) all.push(...parseStoriesFromMarkdown(await f.text(), lps));
    if (!all.length) { toast('No ## headings found in ' + list.map((f) => f.name).join(', ')); return; }
    setImporting({ fileName: list.length === 1 ? list[0].name : list[0].name + ' + ' + (list.length - 1) + ' more', stories: all });
  };
  const askCoach = () => {
    // M3: Flash reads the stories and names which stretch to each gap. Until then, the keyword tagger has a go.
    const found = gapLps.map((l) => ({ lp: l, stories: gapCandidates(storyRows, l) })).filter((x) => x.stories.length);
    if (!found.length) { toast('No obvious candidates in your stories — the coach reads them more closely once a Gemini key is set (M3)'); return; }
    toast('Candidates · ' + found.map((x) => x.lp.name + ': ' + x.stories.slice(0, 2).map((s) => s.title).join(', ')).join(' · '));
  };

  const coverage = (
    <div className="gd-cov-block">
      <div className="gd-cov">
        <span><span className="n">{coveredCount}</span> of {total} LPs covered<span className="gd-phone"> · one tap cycles none → primary → secondary</span></span>
        {gapLps.length ? <span className="gd-gaps">{plural(gapLps.length, 'gap')}</span> : <span className="gd-gaps ok">every LP covered</span>}
      </div>
      <div className="progress-bar" role="progressbar" aria-valuenow={coveredCount} aria-valuemin={0} aria-valuemax={total} aria-label="LPs covered"><span style={{ width: pct + '%' }} /></div>
    </div>
  );

  return (
    <div className="screen">
      <div className="gd-back"><BackHead onBack={() => go(paths.library('stories'))} label="Stories" /></div>
      <div className="screen-body gd-body">
        <div className="gd-head">
          <div className="gd-head-left">
            <div className="gd-tabs" role="tablist" aria-label="Stories view">
              <button type="button" role="tab" aria-selected={false} onClick={() => go(paths.library('stories'))}>Cards</button>
              <button type="button" role="tab" aria-selected className="on">Story × LP grid</button>
            </div>
            <span className="gd-title">Story × LP</span>
          </div>
          <div className="gd-right">
            {coverage}
            <div className="gd-tools">
              <button type="button" className="btn md" style={{ height: 40, fontSize: 14 }} onClick={() => picker.current?.click()}>Import markdown</button>
              <button type="button" className="btn md ink" style={{ height: 40, fontSize: 14, padding: '0 18px' }} onClick={() => openSheet('addStory')}>+ Story</button>
            </div>
          </div>
        </div>

        <div className="gd-card" role="grid" aria-label="Story × LP grid" aria-rowcount={storyRows.length + 2} aria-colcount={total + 2}>
          <div className="gd-row hdr" role="row">
            <span role="columnheader" aria-label="Story" />
            {lps.map((l) => <span key={l.id} role="columnheader" className={'gd-short' + (covered.has(l.id) ? '' : ' gap')} title={l.name + (covered.has(l.id) ? '' : ' · no story yet')}>{l.short}</span>)}
            <span role="columnheader" className="gd-used-h">Used</span>
          </div>
          {storyRows.map((s) => (
            <div key={s.id} className="gd-row" role="row">
              <button type="button" role="rowheader" className={'gd-story' + (s.overused ? ' over' : '')} title={s.title + (s.overused ? ' · over-used' : '')} onClick={() => go(paths.story(s.id))}>{s.title}</button>
              {lps.map((l) => {
                const role = roleOf(s, l.id);
                const key = s.id + ':' + l.id;
                return (
                  <button key={l.id} type="button" role="gridcell" className={'gd-cell' + (role ? ' ' + role : '')} disabled={busyCell === key}
                    title={s.title + ' × ' + l.name + ' · ' + (role ?? 'none') + ' → ' + (nextRole(role) ?? 'none')} aria-label={s.title + ' × ' + l.name + ' · ' + (role ?? 'none')}
                    onClick={() => void cycle(s, l)} />
                );
              })}
              <span role="gridcell" className={'gd-uses' + (s.overused ? ' over' : '')} title={'Used ' + s.uses + ' times in sessions'}>{s.uses}×</span>
            </div>
          ))}
          {storyRows.length === 0 && <div className="gd-empty">No stories yet. Add one or import a markdown file — one <span className="mono">## heading</span> per story.</div>}
          <div className="gd-row gaprow" role="row">
            <span role="rowheader" className="gd-gaplabel"><span className="gd-phone">gap</span><span className="gd-desk">No strong story</span></span>
            {lps.map((l) => <span key={l.id} role="gridcell" className={'gd-gapbar' + (covered.has(l.id) ? '' : ' gap')} aria-label={l.name + (covered.has(l.id) ? ' · covered' : ' · gap')} />)}
            <span role="gridcell" className="gd-uses" aria-hidden="true" />
          </div>
        </div>

        <div className="gd-panels">
          <div className="gd-legend" aria-label="Legend">
            <span><span className="gd-sw primary" />Primary</span>
            <span><span className="gd-sw secondary" />Secondary</span>
            <span className="phone"><span className="gd-sw gap" />No strong story</span>
            <span className="desk"><span className="gd-sw none" />One tap cycles none → primary → secondary</span>
          </div>
          {over && (
            <div className="gd-panel over">
              <span className="label gold">Over-used</span>
              <span><strong>{over.title}</strong> covers {plural(over.links.length, 'LP')} and was used {over.uses} times. <span className="gd-phone">A loop will notice — map</span><span className="gd-desk">Map</span> a second story to {overSecondaries.length ? joinNames(overSecondaries) : 'its LPs'}.</span>
            </div>
          )}
          {gapLps.length > 0 && (
            <div className="gd-panel">
              <span className="label">Gaps</span>
              <span>
                {gapLps.map((l) => l.name).join(' · ')}
                <span className="gd-phone"> — no story mapped. <button type="button" className="gd-ask" onClick={askCoach}>Ask the coach for candidates</button></span>
                <span className="gd-desk">. Click a cell to map; the coach can suggest which of your stories stretch to them. <button type="button" className="gd-ask" onClick={askCoach}>Ask the coach</button></span>
              </span>
            </div>
          )}
          {!over && gapLps.length === 0 && storyRows.length > 0 && (
            <div className="gd-panel"><span className="label green">Covered</span><span>Every LP has a story and none is over-used. Keep the secondary mappings honest — the coach will push you to vary them.</span></div>
          )}
        </div>
      </div>
      <div className="screen-foot gd-foot"><button type="button" className="btn block" onClick={() => picker.current?.click()}><Icon.Upload size={18} />Import stories from markdown</button></div>
      <input ref={picker} type="file" multiple accept=".md,.txt" style={{ display: 'none' }} aria-hidden="true" onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ''; if (l.length) void onFiles(l); }} />
      {importing && <ImportStories open fileName={importing.fileName} stories={importing.stories} onClose={() => setImporting(null)} onDone={(n) => { setImporting(null); if (n) toast('Imported ' + plural(n, 'story', 'stories')); }} />}
    </div>
  );
}
