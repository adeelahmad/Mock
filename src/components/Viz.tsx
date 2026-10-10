// Mock — the voice visual. Three variants (orb, wave, ring); the colour carries the
// mode (gold = interviewer, blue = coach, ink = you) and the motion carries who is speaking.
import React from 'react';

export default function Viz({ kind = 'orb', who = 'none', accent = 'warm', size = 200, w, h }) {
  const col = who === 'ai' ? (accent === 'cool' ? 'var(--m-cool)' : 'var(--m-warm)') : who === 'me' ? 'var(--m-fg)' : 'var(--m-fg3)';
  if (kind === 'wave') {
    const ww = w || size, hh = h || Math.round(size * .5), n = Math.max(9, Math.floor(ww / 9));
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, width: ww, height: hh }} aria-hidden="true">
        {Array.from({ length: n }, (_, i) => {
          const c = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
          const amp = who === 'none' ? .06 : (.3 + .7 * (1 - c * c));
          const anim = who === 'none' ? 'mock-idle 2.6s ' + (i * .12).toFixed(2) + 's ease-in-out infinite' : 'mock-bar ' + (.55 + ((i * 7) % 5) * .12).toFixed(2) + 's ' + (((i * 3) % 7) * .07).toFixed(2) + 's ease-in-out infinite alternate';
          return <span key={i} style={{ width: 4, borderRadius: 2, background: col, height: Math.max(4, Math.round(hh * amp)), transformOrigin: 'center', animation: anim }} />;
        })}
      </div>
    );
  }
  if (kind === 'ring') {
    const r = size / 2 - 4, c = 2 * Math.PI * r;
    return (
      <svg width={size} height={size} viewBox={'0 0 ' + size + ' ' + size} style={{ display: 'block' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={1} opacity={.25} />
        {who === 'none'
          ? <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={2} strokeDasharray={(c * .08) + ' ' + (c * .92)} strokeLinecap="round" style={{ transformOrigin: '50% 50%', animation: 'mock-spin 6s linear infinite' }} />
          : [0, 1, 2].map((i) => { const rr = r - i * (size * .06), cc = 2 * Math.PI * rr; return <circle key={i} cx={size / 2} cy={size / 2} r={rr} fill="none" stroke={col} strokeWidth={i === 0 ? 3 : 2} opacity={1 - i * .28} strokeDasharray={(cc * (.55 - i * .12)) + ' ' + cc} strokeLinecap="round" style={{ transformOrigin: '50% 50%', animation: 'mock-spin ' + (2.4 + i * 1.1) + 's linear infinite' + (i % 2 ? ' reverse' : '') }} />; })}
        <circle cx={size / 2} cy={size / 2} r={who === 'none' ? 4 : size * .11} fill={col} style={{ transformOrigin: '50% 50%', animation: who === 'none' ? 'none' : 'mock-pulse 1.1s ease-in-out infinite' }} />
      </svg>
    );
  }
  const core = who === 'none' ? size * .18 : size * .42;
  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'grid', placeItems: 'center' }} aria-hidden="true">
      {who === 'none'
        ? <span style={{ position: 'absolute', inset: '22%', borderRadius: '50%', border: '1.5px solid ' + col, animation: 'mock-breathe 3.2s ease-in-out infinite' }} />
        : [0, 1, 2].map((i) => <span key={i} style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid ' + col, opacity: 0, animation: 'mock-ping 2.1s ' + (i * .7).toFixed(1) + 's cubic-bezier(.2,0,0,1) infinite' }} />)}
      <span style={{ width: core, height: core, borderRadius: '50%', background: col, animation: who === 'none' ? 'none' : 'mock-pulse 1.1s ease-in-out infinite', transition: 'width .32s,height .32s' }} />
    </div>
  );
}
