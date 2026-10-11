// Mock — the session transcript in History: one row per line, coloured by speaker (interviewer
// warm, you blue, coach green), each with its tone (sentiment) read, and on your own lines
// ✦ Ask AI: rewrite just that line as a stronger answer or with a better story from your
// library. Every rewrite is kept as a version; ‹ › steps between them and the original.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { fmt } from './ui.tsx';
import type { Exchange, Lp, TranscriptEvent } from '../domain/types.ts';
import { EMPTY_INSIGHTS, loadInsights, localPolish, localSentiment, localStory, newRewriteId, saveInsights, type Rewrite, type RewriteKind, type Sentiment, type SessionInsights } from '../domain/insights.ts';
import { readSentiment, rewriteLine } from '../gemini/insights.ts';

const KIND_LABEL: Record<RewriteKind, string> = { improve: 'Improved answer', story: 'Better story' };

export interface TranscriptProps {
  sessionId: string;
  events: TranscriptEvent[];
  xs: Exchange[];
  lps: Lp[];
  curLine: number;
  who: (t: TranscriptEvent) => string;
  onSeek: (tMs: number) => void;
  lineRef: (i: number, el: HTMLDivElement | null) => void;
}

const exchangeOf = (t: TranscriptEvent, xs: Exchange[]): Exchange | undefined =>
  t.exchangeId ? xs.find((e) => e.id === t.exchangeId) : xs.find((e) => t.tMs >= e.startMs && (e.endMs == null || t.tMs < e.endMs));

export default function Transcript({ sessionId, events, xs, lps, curLine, who, onSeek, lineRef }: TranscriptProps) {
  const { repo, gemini, data, toast } = useApp();
  const [ins, setIns] = useState<SessionInsights>(EMPTY_INSIGHTS);
  const [loaded, setLoaded] = useState(false);
  const [reading, setReading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const insRef = useRef(ins); insRef.current = ins;

  useEffect(() => {
    let alive = true; setLoaded(false);
    void loadInsights(repo, sessionId).then((x) => { if (alive) { setIns(x); setLoaded(true); } });
    return () => { alive = false; };
  }, [repo, sessionId]);

  const update = useCallback(async (f: (x: SessionInsights) => SessionInsights) => {
    const next = f(insRef.current); insRef.current = next; setIns(next);
    await saveInsights(repo, sessionId, next).catch(() => {});
  }, [repo, sessionId]);

  // With a key, Flash reads the tone of the whole session once; the result is kept with the session.
  useEffect(() => {
    if (!loaded || ins.sentiment || !gemini.key || !events.length) return;
    const ctl = new AbortController(); setReading(true);
    readSentiment({ key: gemini.key, model: data.settings.textModel, events, signal: ctl.signal })
      .then((s) => { if (!ctl.signal.aborted && Object.keys(s).length) void update((x) => ({ ...x, sentiment: s })); })
      .catch(() => { /* the offline read stays */ })
      .finally(() => { if (!ctl.signal.aborted) setReading(false); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, gemini.key, events.length, !!ins.sentiment]);

  const tones = useMemo(() => events.map((t): Sentiment & { by: 'ai' | 'local' } => {
    const ai = ins.sentiment?.[t.id];
    return ai ? { ...ai, by: 'ai' } : { ...localSentiment(t.text, t.speaker), by: 'local' };
  }), [events, ins.sentiment]);
  const tally = useMemo(() => tones.reduce((a, s, i) => (events[i].speaker === 'me' ? { ...a, [s.label]: a[s.label] + 1 } : a), { positive: 0, neutral: 0, negative: 0 }), [tones, events]);
  const byAi = tones.some((s) => s.by === 'ai');

  if (!events.length) return <span className="sub hist-none">No transcript stored for this session.</span>;

  return (
    <>
      <div className="tr-tone-sum" aria-label="Your tone across the session">
        <span className="label">Your tone</span>
        <span className="tr-sent positive"><i />{tally.positive} positive</span>
        <span className="tr-sent neutral"><i />{tally.neutral} neutral</span>
        <span className="tr-sent negative"><i />{tally.negative} negative</span>
        <span className="tr-tone-by">{reading ? 'reading with Flash…' : byAi ? 'read by Flash' : 'offline read'}</span>
      </div>
      {events.map((t, i) => {
        const s = tones[i];
        const mine = t.speaker === 'me';
        return (
          <div key={t.id} ref={(el) => lineRef(i, el)} className={'tr-row ' + t.speaker + (i === curLine ? ' now' : '') + (open === t.id ? ' open' : '')} aria-current={i === curLine ? 'true' : undefined}>
            <button type="button" className="tr-seek" onClick={() => onSeek(t.tMs)} title="Seek to this line">
              <span className="tr-time">{fmt(t.tMs / 1000)}</span>
              <span className="tr-body">
                <span className="tr-head"><span className={'tr-who ' + t.speaker}>{who(t)}</span><span className={'tr-sent ' + s.label} title={s.label + ' · ' + (s.score > 0 ? '+' : '') + s.score.toFixed(2) + (s.by === 'ai' ? ' · Flash' : ' · offline')}><i />{s.tone}</span></span>
                <span className="tr-text">{t.text}</span>
              </span>
            </button>
            {mine && (
              <button type="button" className={'tr-ask' + (open === t.id ? ' on' : '')} aria-expanded={open === t.id} aria-label={'Ask AI about the line at ' + fmt(t.tMs / 1000)} onClick={() => setOpen((o) => (o === t.id ? null : t.id))}>
                ✦ Ask AI{(ins.rewrites[t.id]?.length ?? 0) > 0 && <span className="tr-ask-n">{ins.rewrites[t.id].length}</span>}
              </button>
            )}
            {mine && open === t.id && (
              <AskPanel
                line={t}
                ex={exchangeOf(t, xs)}
                lps={lps}
                versions={ins.rewrites[t.id] ?? []}
                onAdd={(r) => update((x) => ({ ...x, rewrites: { ...x.rewrites, [t.id]: [...(x.rewrites[t.id] ?? []), r] } }))}
                onDelete={(id) => update((x) => ({ ...x, rewrites: { ...x.rewrites, [t.id]: (x.rewrites[t.id] ?? []).filter((r) => r.id !== id) } }))}
                toast={toast}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function AskPanel({ line, ex, lps, versions, onAdd, onDelete, toast }: { line: TranscriptEvent; ex: Exchange | undefined; lps: Lp[]; versions: Rewrite[]; onAdd: (r: Rewrite) => Promise<void>; onDelete: (id: string) => Promise<void>; toast: (s: string) => void }) {
  const { gemini, data } = useApp();
  // 0 = the original line; 1…n = the versions, oldest first.
  const [at, setAt] = useState(versions.length);
  const [busy, setBusy] = useState<RewriteKind | null>(null);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  useEffect(() => { if (at > versions.length) setAt(versions.length); }, [versions.length, at]);

  const lp = (ex?.lpId ? lps.find((l) => l.id === ex.lpId) : null) ?? null;
  const ask = async (kind: RewriteKind) => {
    ctl.current?.abort(); const c = new AbortController(); ctl.current = c;
    setBusy(kind);
    const previous = versions.filter((r) => r.kind === kind).map((r) => r.text);
    const local = (): string => (kind === 'improve' ? localPolish(line.text) : localStory(data.stories, ex?.lpId ?? null, previous.length));
    let text: string, by: Rewrite['by'] = 'local';
    if (gemini.key) {
      try { text = await rewriteLine({ key: gemini.key, model: data.settings.textModel, kind, line: line.text, question: ex?.questionText ?? '', lp, stories: data.stories, previous, signal: c.signal }); by = 'ai'; }
      catch (err) { if (c.signal.aborted) return; text = local(); toast('Flash unavailable — wrote it offline (' + (err as Error).message + ')'); }
    } else {
      await new Promise((r) => setTimeout(r, 350));
      if (c.signal.aborted) return;
      text = local();
    }
    await onAdd({ id: newRewriteId(), kind, text, at: new Date().toISOString(), by });
    setAt(versions.length + 1); setBusy(null);
  };

  const cur = at > 0 ? versions[at - 1] : null;
  const copy = async () => { try { await navigator.clipboard.writeText(cur?.text ?? line.text); toast('Copied'); } catch { toast('Copy failed'); } };

  return (
    <div className="tr-ai" role="region" aria-label="Ask AI">
      <div className="tr-ai-actions">
        <button type="button" className="btn sm" disabled={!!busy} onClick={() => void ask('improve')}>{busy === 'improve' ? 'Improving…' : 'Improve this answer'}</button>
        <button type="button" className="btn sm" disabled={!!busy} onClick={() => void ask('story')}>{busy === 'story' ? 'Finding a story…' : 'Better story'}</button>
        {!gemini.key && <span className="tr-ai-note">offline · add a Gemini key for Flash</span>}
      </div>
      {versions.length > 0 && (
        <>
          <div className="tr-ai-nav">
            <button type="button" className="icon-btn sm" aria-label="Previous version" disabled={at <= 0} onClick={() => setAt((a) => Math.max(0, a - 1))}>‹</button>
            <span className="tr-ai-pos" aria-live="polite">{cur ? KIND_LABEL[cur.kind] + ' · v' + at + ' of ' + versions.length + (cur.by === 'local' ? ' · offline' : '') : 'Original · ' + versions.length + ' version' + (versions.length === 1 ? '' : 's')}</span>
            <button type="button" className="icon-btn sm" aria-label="Next version" disabled={at >= versions.length} onClick={() => setAt((a) => Math.min(versions.length, a + 1))}>›</button>
            <span className="tr-ai-spacer" />
            <button type="button" className="hist-link" onClick={() => void copy()}>Copy</button>
            {cur && <button type="button" className="hist-link" onClick={() => { void onDelete(cur.id); setAt((a) => a - 1); }}>Delete</button>}
          </div>
          <div className={'tr-ai-text' + (cur ? '' : ' original')}>{cur ? cur.text : line.text}</div>
        </>
      )}
    </div>
  );
}
