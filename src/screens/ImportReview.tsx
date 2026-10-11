// Import review (board 3): confident tags are accepted, only the doubtful ones ask. A full
// screen with "Cancel" back and "1 tap to save"; Library renders it in place of its body
// while an import is pending (route-less), FilePreview reaches it through
// `#/library/questions?import=<fileId>`.

import React, { useMemo, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { BackHead } from '../components/ui.tsx';
import { newId } from '../db/repo.ts';
import { SOURCE_LABEL } from '../domain/selectors.ts';
import type { Lp, Question, QuestionSource } from '../domain/types.ts';
import { isNearDuplicate, type ParsedQuestion } from '../domain/parsers.ts';
import '../styles/screens/library.css';

export interface ReviewItem extends ParsedQuestion {
  key: string;
  /** Near-duplicate of a question already in the bank. */
  already: boolean;
}

export interface ReviewData {
  fileName: string;
  /** The source most of the rows carry (shown as “tagged …”). */
  source: QuestionSource;
  items: ReviewItem[];
}

/** Pure: parsed rows → the review's data (dedup against the bank, dominant source). */
export function prepareReview(rows: ParsedQuestion[], opts: { fileName: string; source: QuestionSource; existing: Question[] }): ReviewData {
  const counts = new Map<QuestionSource, number>();
  const items: ReviewItem[] = rows.map((r, i) => {
    const source = r.source ?? opts.source;
    counts.set(source, (counts.get(source) ?? 0) + 1);
    return { ...r, source, key: 'r' + i, already: opts.existing.some((q) => isNearDuplicate(q.text, r.text)) };
  });
  const dominant = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? opts.source;
  return { fileName: opts.fileName, source: dominant, items };
}

const PAGE = 40;

export default function ImportReview({ review, onCancel, onSaved }: { review: ReviewData; onCancel: () => void; onSaved: (saved: number) => void }) {
  const { data, repo, refresh, toast } = useApp();
  const lps = data.lps;
  const lpName = (id: string): string => lps.find((l) => l.id === id)?.name ?? id;
  /** Manual picks: an LP id, '' for untagged; absent = the suggestion stands. */
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [showConfident, setShowConfident] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);

  const items = review.items;
  const chosen = (it: ReviewItem): string => (it.key in picks ? picks[it.key] : it.lpId);
  const isConfident = (it: ReviewItem): boolean => (it.key in picks ? picks[it.key] !== '' : it.confidence === 'high' && !!it.lpId);
  const confident = useMemo(() => items.filter((it) => !skipped.has(it.key) && isConfident(it)), [items, picks, skipped]);
  const needYou = useMemo(() => items.filter((it) => !(it.confidence === 'high' && it.lpId)), [items]);
  const already = items.filter((it) => it.already).length;
  const total = items.length - skipped.size;
  const untaggedCount = items.filter((it) => !skipped.has(it.key) && !chosen(it)).length;

  const lpCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of confident) m.set(chosen(it), (m.get(chosen(it)) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([id, n]) => lpName(id) + (n > 1 ? ' ×' + n : ''));
  }, [confident, picks]);

  const pick = (key: string, lpId: string) => { setPicks((p) => ({ ...p, [key]: lpId })); setChoosing(null); };
  const toggleSkip = (key: string) => setSkipped((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const save = async () => {
    if (busy || !total) return;
    setBusy(true);
    const now = new Date().toISOString();
    const qs: Question[] = items.filter((it) => !skipped.has(it.key)).map((it) => ({
      id: newId('q'), text: it.text, lpIds: chosen(it) ? [chosen(it)] : [], source: it.source ?? review.source, difficulty: it.difficulty ?? 2,
      timesAsked: 0, lastVerdict: null, bestExchangeId: null, tags: it.tags, votes: it.votes, sample: it.sample, createdAt: now,
    }));
    const n = await repo.addQuestions(qs);
    await refresh();
    setBusy(false);
    const flagged = qs.filter((q) => q.lpIds.length === 0).length;
    toast('Saved ' + n + (n === 1 ? ' question' : ' questions') + (qs.length - n ? ' · ' + (qs.length - n) + ' already in your bank' : '') + (flagged ? ' · ' + flagged + ' flagged for tagging' : ''));
    onSaved(n);
  };

  const sourceLabel = SOURCE_LABEL[review.source];
  const visibleNeed = needYou.slice(0, limit);

  const lpSelect = (it: ReviewItem) => (
    <select className="input lp-select" autoFocus aria-label={'Area for: ' + it.text} value={chosen(it)} onBlur={() => setChoosing(null)} onChange={(e) => pick(it.key, e.target.value)}>
      <option value="">Untagged · leave flagged</option>
      {lps.map((l: Lp) => <option key={l.id} value={l.id}>{l.name}</option>)}
    </select>
  );

  return (
    <div className="screen">
      <BackHead onBack={onCancel} label="Cancel" right={<span className="lib-note" style={{ color: 'var(--m-fg3)', paddingRight: 8 }}>1 tap to save</span>} />
      <div className="screen-body" style={{ paddingTop: 6 }}>
        <div className="stack g4">
          <span className="rv-title">{items.length} {items.length === 1 ? 'question' : 'questions'} found</span>
          <span className="rv-sub"><span className="mono">{review.fileName}</span> · tagged “{sourceLabel}” · {already ? already + ' already in your bank' : 'none in your bank yet'}</span>
        </div>

        {confident.length > 0 ? (
          <div className="rv-box">
            <span className="rv-count">{confident.length}</span>
            <div className="stack g2 grow"><span className="rv-h">tagged with confidence</span><span className="rv-list">{lpCounts.join(', ')}</span></div>
            <button type="button" className="btn link" onClick={() => setShowConfident((s) => !s)} aria-expanded={showConfident}>{showConfident ? 'Hide' : 'Review'}</button>
          </div>
        ) : (
          <div className="rv-box quiet">
            <span className="rv-count">0</span>
            <div className="stack g2 grow"><span className="rv-h">tagged with confidence</span><span className="rv-list">Pick the areas below, or save and tag later.</span></div>
          </div>
        )}
        {showConfident && confident.length > 0 && (
          <div className="list r12">
            {confident.map((it) => (
              <div key={it.key} className="rv-conf-row">
                <span className="rv-cq">{it.text}</span>
                {choosing === it.key ? lpSelect(it) : <button type="button" className="lp-tag" title="Change the area" onClick={() => setChoosing(it.key)}>{lpName(chosen(it))}</button>}
              </div>
            ))}
          </div>
        )}

        <span className={'label ' + (needYou.length ? 'gold' : '')}>{needYou.length ? needYou.length + ' need you · or leave them flagged' : 'Nothing needs you'}</span>
        {needYou.length > 0 && (
          <div className="list">
            {visibleNeed.map((it) => {
              const cur = chosen(it);
              const isSkipped = skipped.has(it.key);
              const alts = it.alternatives.filter((a) => a !== it.lpId);
              return (
                <div key={it.key} className={'rv-item' + (isSkipped ? ' skipped' : '')}>
                  <span className="rv-q">{it.text}</span>
                  <div className="rv-chips">
                    {!isSkipped && it.lpId && (
                      <button type="button" className={'pick ' + (cur === it.lpId && it.key in picks ? 'on' : 'gold')} onClick={() => pick(it.key, it.lpId)} aria-pressed={cur === it.lpId && it.key in picks}>
                        {lpName(it.lpId)}{cur === it.lpId && it.key in picks ? ' ✓' : '?'}
                      </button>
                    )}
                    {!isSkipped && alts.map((a) => (
                      <button key={a} type="button" className={'pick' + (cur === a ? ' on' : '')} onClick={() => pick(it.key, a)} aria-pressed={cur === a}>{lpName(a)}{cur === a ? ' ✓' : ''}</button>
                    ))}
                    {!isSkipped && cur && cur !== it.lpId && !alts.includes(cur) && <button type="button" className="pick on" onClick={() => setChoosing(it.key)}>{lpName(cur)} ✓</button>}
                    {!isSkipped && (choosing === it.key ? lpSelect(it) : <button type="button" className="pick quiet" onClick={() => setChoosing(it.key)}>{it.lpId || alts.length ? 'Other…' : 'Pick an area…'}</button>)}
                    <button type="button" className={'pick' + (isSkipped ? ' on' : ' quiet')} onClick={() => toggleSkip(it.key)} aria-pressed={isSkipped}>{isSkipped ? 'Skipped · undo' : 'Follow-up, not a question'}</button>
                  </div>
                </div>
              );
            })}
            {needYou.length > limit && <button type="button" className="show-more" onClick={() => setLimit((n) => n + PAGE)}>Show more · {needYou.length - limit} left</button>}
          </div>
        )}
      </div>
      <div className="screen-foot">
        <button type="button" className="btn lg ink block" style={{ maxWidth: 760 }} disabled={busy || !total} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save all ' + total}
        </button>
        <span className="rv-foot-note">{untaggedCount ? untaggedCount + (untaggedCount === 1 ? ' unresolved tag stays' : ' unresolved tags stay') : 'Unresolved tags stay'} flagged in the bank — never a blocker.</span>
      </div>
    </div>
  );
}
