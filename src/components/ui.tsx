// Mock — UI primitives. Defined once (Foundations board) and reused verbatim across screens.
import React, { useState } from 'react';
import { VERDICTS as VSTYLES, verdictStyle, verdictBorder } from '../domain/verdict.ts';
import type { Verdict, VerdictCode } from '../domain/types.ts';

// ---------- Icons (Lucide-style, 2px stroke) ----------
export interface IconProps { size?: number; style?: React.CSSProperties; className?: string }
const I = ({ size = 20, style, className = '', fill = false, children }: IconProps & { fill?: boolean; children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" className={'ic ' + className} style={{ width: size, height: size, ...(fill ? { fill: 'currentColor', stroke: 'none' } : {}), ...style }} aria-hidden="true">{children}</svg>
);
export const Icon = {
  Mic: (p: IconProps) => <I {...p}><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></I>,
  MicOff: (p: IconProps) => <I {...p}><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="2" x2="22" y1="2" y2="22" /></I>,
  Library: (p: IconProps) => <I {...p}><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></I>,
  Clock: (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></I>,
  Trend: (p: IconProps) => <I {...p}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></I>,
  Target: (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></I>,
  Settings: (p: IconProps) => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></I>,
  Back: (p: IconProps) => <I {...p}><path d="m15 18-6-6 6-6" /></I>,
  Forward: (p: IconProps) => <I {...p}><path d="m9 18 6-6-6-6" /></I>,
  Close: (p: IconProps) => <I {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></I>,
  Redo: (p: IconProps) => <I {...p}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></I>,
  Next: (p: IconProps) => <I {...p}><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" x2="19" y1="5" y2="19" /></I>,
  Pause: (p: IconProps) => <I {...p} fill><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></I>,
  Play: (p: IconProps) => <I {...p} fill><polygon points="6 3 20 12 6 21 6 3" /></I>,
  Bulb: (p: IconProps) => <I {...p}><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" /></I>,
  Up: (p: IconProps) => <I {...p}><path d="m18 15-6-6-6 6" /></I>,
  Down: (p: IconProps) => <I {...p}><path d="m6 9 6 6 6-6" /></I>,
  Download: (p: IconProps) => <I {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></I>,
  Upload: (p: IconProps) => <I {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" /></I>,
  Search: (p: IconProps) => <I {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></I>,
  Check: (p: IconProps) => <I {...p}><path d="M20 6 9 17l-5-5" /></I>,
  File: (p: IconProps) => <I {...p}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></I>,
  PlayOutline: (p: IconProps) => <I {...p}><polygon points="6 3 20 12 6 21 6 3" /></I>,
};

// ---------- Verdicts ----------
export interface VerdictView { vCode: VerdictCode; vLabel: string; vGlyph: string; vBg: string; vFg: string; vLine: string; vFill: string; vOnFill: string; vBorder: string }
export const v = (code: Verdict | VerdictCode | null | undefined): VerdictView => {
  const d = verdictStyle(code);
  return { vCode: d.code, vLabel: d.label, vGlyph: d.glyph, vBg: d.bg, vFg: d.fg, vLine: d.line, vFill: d.fill, vOnFill: d.onFill, vBorder: verdictBorder(d) };
};
export { VSTYLES as VERDICTS };
export function VerdictChip({ code, size = '', style }: { code: Verdict | VerdictCode | null | undefined; size?: '' | 'md' | 'lg'; style?: React.CSSProperties }) {
  const d = v(code);
  return (
    <span className={'chip none ' + size} style={{ background: d.vBg, color: d.vFg, border: d.vBorder, ...style }}>
      <span>{d.vGlyph}</span>{d.vLabel}
    </span>
  );
}
export function VerdictCell({ code, size = 22, radius = 4, font = 10, title, style, glyph = true }: { code: Verdict | VerdictCode | null | undefined; size?: number; radius?: number; font?: number; title?: string; style?: React.CSSProperties; glyph?: boolean }) {
  const d = v(code);
  return <span title={title} className="verdict-cell" style={{ height: size, borderRadius: radius, background: d.vFill, color: d.vOnFill, fontSize: font, ...style }}>{glyph ? d.vGlyph : ''}</span>;
}

// ---------- Controls ----------
export function Seg<T extends string>({ value, options, onChange, className = '' }: { value: T; options: [T, React.ReactNode][]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={'seg ' + className} role="tablist">
      {options.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>)}
    </div>
  );
}

type InputBase = { label?: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; mono?: boolean; style?: React.CSSProperties; className?: string };
type InputProps = InputBase & ({ multiline?: false } & React.InputHTMLAttributes<HTMLInputElement>) | InputBase & ({ multiline: true } & React.TextareaHTMLAttributes<HTMLTextAreaElement>);
export function Input(props: InputProps) {
  const { label, hint, error, mono = false, style, className = '', ...rest } = props as InputBase & { multiline?: boolean } & Record<string, unknown>;
  const multiline = !!(rest as { multiline?: boolean }).multiline;
  delete (rest as { multiline?: boolean }).multiline;
  return (
    <label className={'field ' + className} style={style}>
      {label && <span className="field-label">{label}</span>}
      {multiline
        ? <textarea className={'textarea' + (mono ? ' mono' : '')} rows={3} {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} />
        : <input className={'input' + (mono ? ' mono' : '')} {...(rest as React.InputHTMLAttributes<HTMLInputElement>)} />}
      {(error || hint) && <span className={'field-hint' + (error ? ' error' : '')}>{error || hint}</span>}
    </label>
  );
}

export type SelectOption = string | { value: string; label: string };
export function Select({ label, options = [], value, onChange, style, disabled }: { label?: React.ReactNode; options?: SelectOption[]; value: string; onChange?: (v: string) => void; style?: React.CSSProperties; disabled?: boolean }) {
  return (
    <label className="field" style={style}>
      {label && <span className="field-label">{label}</span>}
      <span className="select-wrap">
        <select value={value} disabled={disabled} onChange={(e) => onChange?.(e.target.value)}>
          {options.map((o) => { const x = typeof o === 'string' ? { value: o, label: o } : o; return <option key={x.value} value={x.value}>{x.label}</option>; })}
        </select>
      </span>
    </label>
  );
}
export function Switch({ checked, onChange, label }: { checked: boolean; onChange?: (on: boolean) => void; label?: string }) {
  return <button type="button" role="switch" aria-checked={!!checked} aria-label={label} className={'switch' + (checked ? ' on' : '')} onClick={() => onChange?.(!checked)} />;
}

// ---------- File drop ----------
export function Dropzone({ id, title, sub, accept, multiple = true, onFiles, style, directory = false }: { id: string; title: React.ReactNode; sub?: React.ReactNode; accept?: string; multiple?: boolean; onFiles: (files: File[]) => void; style?: React.CSSProperties; directory?: boolean }) {
  const [over, setOver] = useState(false);
  const take = (files: FileList | null) => { const list = Array.from(files ?? []); if (list.length) onFiles(list); };
  const extra = directory ? ({ webkitdirectory: '' } as Record<string, string>) : {};
  return (
    <label htmlFor={id} className={'dropzone' + (over ? ' over' : '')} style={style} tabIndex={0} role="button"
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (document.getElementById(id) as HTMLInputElement | null)?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
      <span style={{ font: '700 14px/1.2 var(--font-sans)' }}>{title}</span>
      {sub && <span className="sub" style={{ fontSize: 12, lineHeight: 1.4 }}>{sub}</span>}
      <input id={id} type="file" multiple={multiple} accept={accept} style={{ display: 'none' }} {...extra} onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
    </label>
  );
}

// ---------- Sheet (bottom sheet on phone, centred dialog on desktop) ----------
export function Sheet({ open, onClose, tall = false, title, eyebrow, children, foot, zIndex = 10, head }: { open: boolean; onClose: () => void; tall?: boolean; title?: React.ReactNode; eyebrow?: React.ReactNode; children?: React.ReactNode; foot?: React.ReactNode; zIndex?: number; head?: React.ReactNode }) {
  if (!open) return null;
  return (
    <>
      <div className="scrim" style={{ zIndex }} onClick={onClose} />
      <div className={'sheet' + (tall ? ' tall' : '')} style={{ zIndex: zIndex + 1 }} role="dialog" aria-modal="true">
        <div className="sheet-grab"><span /></div>
        {head ?? (
          <div className="sheet-head">
            <div className="stack g2">
              {eyebrow && <span className="label cool">{eyebrow}</span>}
              <span style={{ font: '800 24px/1.1 var(--font-sans)', letterSpacing: '-.025em' }}>{title}</span>
            </div>
            <button className="icon-btn sm" aria-label="Close" onClick={onClose}><Icon.Close size={18} /></button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
        {foot && <div className="sheet-foot">{foot}</div>}
      </div>
    </>
  );
}

export function BackHead({ onBack, label, right }: { onBack: () => void; label: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="screen-head back">
      <button className="back-btn" onClick={onBack}><Icon.Back />{label}</button>
      {right}
    </div>
  );
}

export const fmt = (s: number): string => { s = Math.max(0, s | 0); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
export const fmtClock = (sec: number): string => { const s = Math.max(0, Math.round(sec)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export const download = (name: string, blob: Blob): void => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
/** Labels that wrap a hidden file input are not focusable; this makes Enter/Space open the picker. */
export const keyClick = (e: React.KeyboardEvent<HTMLElement>): void => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } };

