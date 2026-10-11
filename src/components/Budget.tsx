// Mock — the Gemini spend. `SpendBar` sits on top of every screen: the total so far, and on tap
// the split per Leadership Principle. `BudgetSettings` is the editable price table (USD per 1M
// tokens; changing a price re-prices everything already spent) and the reset.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { DEFAULT_PRICING, fmtTokens, fmtUsd, spend } from '../domain/budget.ts';
import type { ModelPrice } from '../domain/types.ts';

/** `float`: over the top-right of phone screens; `side`: in the desktop sidebar; `compact`: in the live header. */
export function SpendBar({ variant = 'float' }: { variant?: 'float' | 'side' | 'compact' }) {
  const { data } = useApp();
  const s = useMemo(() => spend(data.settings.usage ?? [], data.settings.pricing ?? DEFAULT_PRICING, data.lps), [data.settings.usage, data.settings.pricing, data.lps]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const max = s.rows[0]?.usd || 1;
  return (
    <div className={'spendbar ' + variant} ref={ref}>
      <button className="spend-pill" aria-expanded={open} aria-label={'Gemini spend ' + fmtUsd(s.total) + ', show per area'} onClick={() => setOpen((o) => !o)}>
        <span className="spend-label">Spent</span><span className="spend-total">{fmtUsd(s.total)}</span>
      </button>
      {open && (
        <div className="spend-pop" role="dialog" aria-label="Spend per area">
          <div className="spend-head"><span className="label">Spend per area</span><span className="mono sub">{fmtTokens(s.tokens)} tokens</span></div>
          {s.rows.length === 0 && <span className="sub">Nothing spent yet. Sessions with a Gemini key count here.</span>}
          {s.rows.map((r) => (
            <div key={r.lpId ?? '-'} className="spend-row">
              <span className="spend-name">{r.label}</span>
              <span className="spend-usd mono">{fmtUsd(r.usd)}</span>
              <span className="spend-meter" aria-hidden="true"><span style={{ width: Math.max(2, (r.usd / max) * 100) + '%' }} /></span>
            </div>
          ))}
          <div className="spend-row total"><span className="spend-name">Total</span><span className="spend-usd mono">{fmtUsd(s.total)}</span></div>
          <span className="sub spend-note">Prices are set in Settings → Budget.</span>
        </div>
      )}
    </div>
  );
}

const FIELDS: [keyof Omit<ModelPrice, 'model'>, string][] = [['input', 'In'], ['output', 'Out'], ['audioInput', 'Audio in'], ['audioOutput', 'Audio out']];

export function BudgetSettings() {
  const { data, repo, refresh, toast } = useApp();
  const saved = data.settings.pricing ?? DEFAULT_PRICING;
  const [rows, setRows] = useState<ModelPrice[]>(saved);
  useEffect(() => setRows(saved), [saved]);
  const s = useMemo(() => spend(data.settings.usage ?? [], saved, data.lps), [data.settings.usage, saved, data.lps]);
  const save = async (next: ModelPrice[]) => {
    const clean = next.filter((r) => r.model.trim()).map((r) => ({ ...r, model: r.model.trim() }));
    await repo.setSettings({ pricing: clean });
    await refresh();
  };
  const edit = (i: number, k: keyof ModelPrice, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: k === 'model' ? v : Math.max(0, Number(v) || 0) } : r)));
  const commit = () => { if (JSON.stringify(rows) !== JSON.stringify(saved)) void save(rows); };
  const reset = async () => {
    if (!window.confirm('Reset the spend counter to $0? The price table stays.')) return;
    await repo.setSettings({ usage: [] }); await refresh(); toast('Spend reset to $0');
  };
  return (
    <div className="stack g8">
      <div className="hstack between baseline"><span className="label">Budget · {fmtUsd(s.total)} spent</span><button className="btn link" onClick={() => void reset()}>Reset spend</button></div>
      <div className="card pad r12 stack g12">
        <span className="srow-sub">USD per 1M tokens. Spend is counted from the tokens Gemini reports for each call, so a new price re-prices everything spent so far. Models not listed use the first row.</span>
        <div className="price-table" role="table" aria-label="Gemini prices">
          <div className="price-row head" role="row"><span role="columnheader">Model</span>{FIELDS.map(([k, l]) => <span key={k} role="columnheader">{l}</span>)}<span /></div>
          {rows.map((r, i) => (
            <div className="price-row" role="row" key={i}>
              <input className="price-in mono" aria-label="Model id" value={r.model} spellCheck={false} onChange={(e) => edit(i, 'model', e.target.value)} onBlur={commit} />
              {FIELDS.map(([k, l]) => (
                <input key={k} className="price-in mono num" type="number" min={0} step="0.01" inputMode="decimal" aria-label={r.model + ' ' + l + ' price'} value={r[k]}
                  onChange={(e) => edit(i, k, e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
              ))}
              <button className="price-x" aria-label={'Remove ' + r.model} onClick={() => void save(rows.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
        <div className="hstack" style={{ gap: 12 }}>
          <button className="btn link" onClick={() => setRows((rs) => [...rs, { model: '', input: 0, output: 0, audioInput: 0, audioOutput: 0 }])}>Add model</button>
          <button className="btn link" onClick={() => void save(DEFAULT_PRICING)}>Default prices</button>
        </div>
      </div>
    </div>
  );
}
