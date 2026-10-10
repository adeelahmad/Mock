// Mock — the live session screen. Hands-free: coaching starts when you stop talking;
// the next question follows after coaching. Three layouts (stage, transcript, split).
//
// Two modes:
//   driven  — the app owns the state (a real Gemini Live session) and passes it in via props.
//   demo    — no API key: a scripted run-through of every state, timed on its own.
import React, { useEffect, useRef, useState } from 'react';
import Viz from './Viz.jsx';
import { v, fmt, Icon } from './ui.jsx';

const DEMO_QS = [
  { label: 'Q3', iv: { name: 'Dana Whitfield', first: 'Dana', role: 'Bar Raiser', n: 3, mono: 'DW' }, lp: 'Dive Deep', text: 'Tell me about a time you found a problem that others had missed. How did you find it?', hint: 'Try the Payments outage story — 41 min, $1.2M.',
    notes: [{ t: 'Payments outage', n: '41 min · $1.2M · 0 repeats' }, { t: 'Legacy data migration', n: '14 TB · 6h → 40 min' }, { t: 'Observability cost cut', n: '−38% · $610k/yr' }],
    a: { verdict: 3, strength: 'You named the exact failing component and the metric you watched while fixing it.', fixes: ['Open with the numbers: 41 minutes, $1.2M.', 'Cut the setup to two sentences — the room knows what Black Friday is.', 'Say what you personally did in the first ten minutes.'] },
    turns: [{ ai: true, text: 'Tell me about a time you found a problem that others had missed. How did you find it?' }, { ai: false, text: 'Sure. Black Friday week, 7:40 in the morning — card authorisations started failing for about 18% of EU traffic. On-call assumed the provider.' }, { ai: true, text: 'What made you look at the config path rather than the provider?' }, { ai: false, text: 'Two things. Their status page was green, and the error rate stepped up exactly on a deploy boundary.' }, { ai: true, text: 'How long until it was mitigated?' }, { ai: false, text: 'Under an hour. Forty-something minutes.' }] },
  { label: 'Q4', iv: { name: 'Marcus Oyelaran', first: 'Marcus', role: 'Skip-level', n: 4, mono: 'MO' }, lp: 'Bias for Action', text: 'Tell me about a time you made a decision without all the data you wanted.', hint: 'Launch under ambiguity — lead with the 30% sample.',
    notes: [{ t: 'Launch under ambiguity', n: '30% sample · 5 wks · −22% FP' }, { t: 'Payments outage', n: '41 min · $1.2M · 0 repeats' }],
    a: { verdict: 2, strength: 'Clear framing of what was reversible and what wasn’t.', fixes: ['Quantify the result: −22% false positives.', 'Name the risk you accepted and the trip-wire you set.'] },
    turns: [{ ai: true, text: 'Tell me about a time you made a decision without all the data you wanted.' }, { ai: false, text: 'The fraud-rules MVP. We had a 30% data sample and a quarter-long wait for the rest.' }, { ai: true, text: 'What would have changed your mind?' }] },
];
const DEMO_RECAP = [{ mono: 'PR', name: 'Priya Raman', role: 'Hiring manager', lp: 'Customer Obsession', v: 2 }, { mono: 'TN', name: 'Tomasz Nowak', role: 'Peer SDM', lp: 'Ownership', v: 1 }, { mono: 'DW', name: 'Dana Whitfield', role: 'Bar Raiser', lp: 'Dive Deep', v: 3 }, { mono: 'MO', name: 'Marcus Oyelaran', role: 'Skip-level', lp: 'Bias for Action', v: 2 }, { mono: 'EC', name: 'Elena Castellanos', role: 'Partner team', lp: 'Deliver Results', v: 2 }];

// ---- scripted demo state machine
function useDemo(active) {
  const [s, set] = useState({ st: null, q: 0, words: 0, sec: 0, hint: false, prev: null, shown: 0, recon: false, pass: 0, cd: 5 });
  const T = useRef([]);
  const ref = useRef(s); ref.current = s;
  const clear = () => { T.current.forEach(clearTimeout); T.current = []; };
  const after = (ms, fn) => T.current.push(setTimeout(fn, ms));
  const go = (st, extra) => { clear(); const ns = { ...ref.current, st, ...(extra || {}) }; set(ns); plan(st, ns); };
  const next = () => { if (ref.current.q === 0) go('interviewer', { q: 1, words: 0, sec: 0, hint: false, shown: 0, pass: 0, recon: false }); else go('end'); };
  const plan = (st, ns) => {
    const q = ns.q, Q = DEMO_QS[q], n = Q.text.split(' ').length;
    if (st === 'connecting') after(2400, () => go('interviewer', { words: 0, sec: 0, hint: false, shown: 0, pass: 0 }));
    if (st === 'interviewer') { const step = (i) => { set((x) => ({ ...x, words: i })); if (i < n) after(210, () => step(i + 1)); else after(1100, () => go('answering', { sec: 0 })); }; step(Math.max(1, ns.words || 1)); }
    if (st === 'answering') {
      if (ns.pass === 0) after(7000, () => go('thinking'));
      else { if (q === 1) { after(2500, () => set((x) => ({ ...x, recon: true }))); after(5500, () => set((x) => ({ ...x, recon: false }))); } after(8000, () => go('coaching', { shown: 0, hint: false })); }
    }
    if (st === 'thinking') after(3200, () => { go('answering', { pass: 1, hint: q === 0 }); if (q === 0) after(5200, () => set((x) => ({ ...x, hint: false }))); });
    if (st === 'coaching') { set((x) => ({ ...x, cd: 5 })); [900, 2300, 3700, 5100, 6500].forEach((ms, i) => after(ms, () => set((x) => ({ ...x, shown: i + 1})))); [5, 4, 3, 2, 1].forEach((c, i) => after(6500 + i * 1000, () => set((x) => ({ ...x, cd: c })))); after(11500, next); }
  };
  const start = () => go('connecting', { q: 0, sec: 0, words: 0, hint: false, shown: 0, recon: false, pass: 0, prev: null });
  useEffect(() => {
    if (!active) return;
    start();
    const tick = setInterval(() => set((x) => (x.st === 'answering' || x.st === 'thinking') ? { ...x, sec: x.sec + 1 } : x), 1000);
    return () => { clear(); clearInterval(tick); };
  }, [active]);
  return { s, set, go, start, next, clear, after };
}

export default function LiveScreen(props) {
  const p = props, drv = !!p.driven, demo = !!p.demo && !drv;
  const D = useDemo(demo);
  const [tOpen, setTOpen] = useState(false);
  const [nOpen, setNOpen] = useState(false);

  // Keyboard on desktop: Space pause · R redo · N next · H hint · Esc end.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); (st === 'paused' ? act('resume') : act('pause'))(); }
      else if (k === 'r') act('redo')(); else if (k === 'n') act('next')(); else if (k === 'h') act('hint')(); else if (k === 'escape') act('end')();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  const st = drv ? (p.state || 'connecting') : (D.s.st || 'connecting');
  const q = demo ? D.s.q : 0;
  const ivName = p.ivName || 'Interviewer';
  const Q = drv
    ? { label: p.qLabel || 'Q1', iv: { name: ivName, first: ivName.split(' ')[0], role: p.ivRole || 'Interviewer', n: p.ivN || 1, mono: p.ivMono || 'AI' }, lp: p.lpName || '', text: p.qText || '', hint: p.hintText || '', notes: p.notes || [], a: p.analysis || { verdict: 0, strength: '', fixes: [] }, turns: p.turns || [] }
    : DEMO_QS[q] || DEMO_QS[0];
  const wordsAll = (Q.text || '').split(' ');
  const isPaused = st === 'paused';
  const under = isPaused ? (drv ? (p.prevState || 'answering') : (D.s.prev || 'answering')) : st;
  const words = drv ? wordsAll.length : D.s.words;
  const sec = drv ? (p.sec || 0) : D.s.sec;
  const hint = drv ? !!p.showHint : D.s.hint;
  const recon = drv ? !!p.recon : D.s.recon;
  const shown = drv ? 9 : D.s.shown;
  const layout = p.layout || 'stage', voice = p.voice || 'orb', mode = p.mode || 'loop';
  const isInterviewer = under === 'interviewer', isMine = under === 'answering' || under === 'thinking', isThinking = under === 'thinking';
  const isCoaching = under === 'coaching', isEnd = under === 'end', isConnecting = under === 'connecting';
  const accent = (isCoaching || isEnd) ? 'cool' : 'warm';
  const who = (drv && p.speaker) ? p.speaker : (isInterviewer || isCoaching ? 'ai' : under === 'answering' ? 'me' : 'none');
  const accentFg = accent === 'cool' ? 'var(--m-cool)' : 'var(--m-warm)';
  const accentFill = accent === 'cool' ? 'var(--m-cool-fill)' : 'var(--m-warm-fill)';
  const onAccent = accent === 'cool' ? 'var(--m-on-cool)' : 'var(--m-on-warm)';
  const cue = sec >= 180;
  const a = Q.a, d = v(a.verdict);
  const total = 1 + a.fixes.length + 1;
  const isStage = layout === 'stage', isTL = layout === 'transcript', isSP = layout === 'split';
  const sessionNo = p.sessionNo || 14;
  const recapSrc = drv ? (p.recap || []) : DEMO_RECAP;
  const showHandles = (isInterviewer || isMine) && !isCoaching && !isEnd && !isConnecting;
  const revealing = isInterviewer && words < wordsAll.length;
  const qShown = wordsAll.slice(0, words).join(' ');
  const timerColor = cue ? 'var(--m-warm)' : 'var(--m-fg)';
  const timerNote = isThinking ? 'Still listening — coaching starts when you’re done' : cue ? '3:00 passed · start wrapping up' : 'Your answer';
  const listenDot = isThinking ? 'var(--m-fg3)' : who === 'me' ? 'var(--m-fg)' : accentFg;
  const nowText = isInterviewer ? Q.iv.first + ' is speaking' : isThinking ? 'Still listening' : 'You’re answering';
  const nowSub = isInterviewer ? Q.iv.role : isThinking ? 'Pause detected · mic open' : 'Mic open';
  const nextAuto = drv ? (p.nextAuto || 'or just say “next”') : (shown >= total ? 'auto in ' + (D.s.cd || 5) + ' s · say “redo” to retry' : 'auto after coaching');
  const coachTyping = drv ? !!p.coachTyping : (demo && shown < total);
  const fixesShown = a.fixes.slice(0, Math.max(0, Math.min(a.fixes.length, shown - 1)));
  const mono = isCoaching ? 'Co' : isEnd ? 'M' : Q.iv.mono;
  const roundLabel = isCoaching ? 'Coach · after ' + Q.label : isEnd ? 'Session ' + sessionNo + ' · complete' : 'Interviewer ' + Q.iv.n + ' of 5 · ' + Q.iv.role;
  const headName = isCoaching ? 'Coaching' : isEnd ? 'Mock' : Q.iv.name;
  const modeLabel = mode === 'lp' ? 'One LP' : mode === 'question' ? 'One question' : 'Full loop';

  // Actions: driven → delegate to the app; demo → drive the script.
  const act = (name) => () => {
    if (drv) { p.onAction && p.onAction(name); return; }
    if (!demo) return;
    if (name === 'end') D.go('end');
    else if (name === 'restart') D.start();
    else if (name === 'pause') { D.clear(); D.set((x) => ({ ...x, prev: x.st, st: 'paused' })); }
    else if (name === 'resume') D.go(D.s.prev || 'answering');
    else if (name === 'hint') { D.set((x) => ({ ...x, hint: true })); D.after(6000, () => D.set((x) => ({ ...x, hint: false }))); }
    else if (name === 'dismissHint') D.set((x) => ({ ...x, hint: false }));
    else if (name === 'redo') D.go('interviewer', { words: 0, sec: 0, hint: false, shown: 0, pass: 0, recon: false });
    else if (name === 'feedback') D.go('coaching', { shown: 0, hint: false, recon: false });
    else if (name === 'next') D.next();
  };
  const onReview = () => { if (drv) p.onAction && p.onAction('review'); else if (p.onReview) p.onReview(); };
  const turns = Q.turns.map((t, i) => (
    <div key={i} className={'bubble-row' + (t.ai ? '' : ' me')}>
      {t.ai && <span className="avatar">{Q.iv.mono}</span>}
      <div className="bubble">{t.text}</div>
    </div>
  ));
  const cursor = <span style={{ display: 'inline-block', width: 3, height: '.85em', background: accentFg, marginLeft: 5, verticalAlign: -3, animation: 'mock-blink 1s steps(2) infinite' }} />;
  const vizMain = <Viz kind={voice} who={who} accent={accent} size={200} />;
  const vizSmall = <Viz kind={isCoaching ? 'wave' : voice} who={who} accent={accent} size={isCoaching ? 56 : 48} w={isCoaching ? 56 : 48} h={22} />;
  const roundBtn = (label, icon, fn, big = false) => (
    <div className="stack" style={{ alignItems: 'center', gap: 6, width: big ? 76 : 60 }}>
      <button aria-label={label} onClick={fn} className={big ? '' : 'btn'} style={big ? { width: 72, height: 72, borderRadius: '50%', border: 'none', background: accentFill, color: onAccent, display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: 'var(--shadow-2)' } : { width: 54, height: 54, padding: 0, background: 'var(--m-card)' }}>{icon}</button>
      <span style={{ font: '500 11px/1 var(--font-sans)', color: 'var(--m-fg2)' }}>{label}</span>
    </div>
  );

  return (
    <div className="live" data-state={st} style={{ position: 'relative', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--m-bg)', color: 'var(--m-fg)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accentFill }} />

      <div className="screen-head" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 22px)' }}>
        <div className="hstack" style={{ gap: 12, minWidth: 0 }}>
          <span className="none" style={{ width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--m-elev)', border: '2px solid ' + (who === 'ai' ? accentFg : 'var(--m-line)'), font: '800 13px/1 var(--font-sans)', letterSpacing: '-.02em' }}>{mono}</span>
          <div className="stack g2" style={{ minWidth: 0 }}>
            <span className="label ellipsis" style={{ color: accentFg }}>{roundLabel}</span>
            <span style={{ font: '700 15px/1.2 var(--font-sans)', whiteSpace: 'nowrap' }}>{headName}</span>
          </div>
        </div>
        <div className="hstack">
          {isCoaching && vizSmall}
          {mode !== 'loop' && !isCoaching && !isEnd && !!Q.lp && <span className="chip lg none">{Q.lp}</span>}
          {!isEnd && <button className="btn sm danger" style={{ height: 36, padding: '0 14px', fontSize: 13 }} onClick={act('end')}>End</button>}
        </div>
      </div>

      {recon && (
        <div className="tint gold hstack" style={{ margin: '12px 20px 0', gap: 10, padding: '10px 12px', color: 'var(--m-gold)', font: '500 13px/1.3 var(--font-sans)', animation: 'mock-in .32s var(--ease-standard)' }}>
          <span className="spinner gold" style={{ width: 14, height: 14 }} /><span>Reconnecting… your answer is still being recorded.</span>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '18px 20px 0', gap: 14, position: 'relative' }}>
        {isConnecting && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, textAlign: 'center' }}>
            {vizMain}
            <div className="stack g6"><span style={{ font: '700 20px/1.25 var(--font-sans)', letterSpacing: '-.01em' }}>Connecting to {Q.iv.name}…</span><span className="sub" style={{ fontSize: 14, lineHeight: 1.4 }}>Session {sessionNo} · {modeLabel}{mode === 'loop' ? ' · 5 interviewers' : ''}</span></div>
            <div className="card pad stack g10" style={{ width: '100%', maxWidth: 420, textAlign: 'left', font: '500 13px/1.2 var(--font-sans)' }}>
              <div className="hstack between"><span className="hstack"><span style={{ color: 'var(--m-green)' }}>✓</span>Microphone ready</span><span className="muted">{p.micNote || 'granted at setup'}</span></div>
              <div className="hstack between"><span className="hstack"><span style={{ color: 'var(--m-green)' }}>✓</span>Earbuds connected</span><span className="muted">level ok</span></div>
              <div className="sub">Nothing to tap — {Q.iv.first} starts in a moment.</div>
            </div>
          </div>
        )}

        {isStage && isInterviewer && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
            <div className="pretty" style={{ font: '700 28px/1.2 var(--font-sans)', letterSpacing: '-.02em', minHeight: 168 }}>{qShown}{revealing && cursor}</div>
            <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>{vizMain}</div>
            <div className="hstack sub" style={{ justifyContent: 'center', font: '500 13px/1.2 var(--font-sans)' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: accentFg }} />{Q.iv.first} is speaking</div>
          </div>
        )}

        {isStage && isMine && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
            <div className="pretty" style={{ font: '600 19px/1.3 var(--font-sans)', letterSpacing: '-.01em', color: 'var(--m-fg2)' }}>{Q.text}</div>
            <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>{vizMain}</div>
            <div className="stack" style={{ alignItems: 'center', gap: 6 }}>
              <span className="mono" style={{ font: '500 48px/1 var(--font-mono)', letterSpacing: '-.02em', color: timerColor }}>{fmt(sec)}</span>
              <span className="hstack" style={{ font: '500 13px/1.2 var(--font-sans)', color: cue ? 'var(--m-warm)' : 'var(--m-fg2)' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: listenDot }} />{timerNote}</span>
            </div>
          </div>
        )}

        {isTL && (isInterviewer || isMine) && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--m-card)', borderLeft: '3px solid ' + accentFg }}><div className="label" style={{ marginBottom: 4 }}>{Q.label} · pinned</div><div className="pretty" style={{ font: '600 16px/1.3 var(--font-sans)', letterSpacing: '-.01em' }}>{Q.text}</div></div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'flex-end' }}>{turns}</div>
            <div className="card hstack" style={{ gap: 14, padding: '10px 12px', borderRadius: 14 }}>
              {vizSmall}
              <div className="stack g2 grow"><span style={{ font: '700 14px/1.2 var(--font-sans)' }}>{nowText}</span><span className="sub" style={{ fontSize: 12 }}>{nowSub}</span></div>
              {isMine && <span className="mono" style={{ font: '500 24px/1 var(--font-mono)', color: timerColor }}>{fmt(sec)}</span>}
            </div>
          </div>
        )}

        {isSP && (isInterviewer || isMine) && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
            <div className="card pad stack g12">
              <div className="hstack between">
                <span className="hstack sub" style={{ font: '500 13px/1.2 var(--font-sans)' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: listenDot }} />{nowText}</span>
                {isMine && <span className="mono" style={{ font: '500 22px/1 var(--font-mono)', color: timerColor }}>{fmt(sec)}</span>}
              </div>
              <Viz kind="wave" who={who} accent={accent} size={310} w={310} h={64} />
            </div>
            <div className="pretty" style={{ font: '700 26px/1.2 var(--font-sans)', letterSpacing: '-.02em' }}>{qShown}{revealing && cursor}</div>
            <div style={{ flex: 1 }} />
            {isMine && <div style={{ font: '500 13px/1.3 var(--font-sans)', color: cue ? 'var(--m-warm)' : 'var(--m-fg2)' }}>{timerNote}</div>}
          </div>
        )}

        {isCoaching && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0, overflow: 'auto' }}>
            <div className="stack g4"><span className="label">{Q.label}{Q.lp ? ' · ' + Q.lp : ''} · {Q.iv.first}’s question</span><span className="sub pretty" style={{ font: '500 14px/1.35 var(--font-sans)', color: 'var(--m-fg2)' }}>{Q.text}</span></div>
            {shown >= 1 && (
              <div className="card hstack start" style={{ gap: 10, padding: 12, borderRadius: 12, animation: 'mock-in .32s var(--ease-standard)' }}>
                <span className="none" style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--m-green-tint)', color: 'var(--m-green)', display: 'grid', placeItems: 'center', font: '700 12px/1 var(--font-sans)' }}>✓</span>
                <div className="stack g2"><span className="label green">Strength</span><span className="pretty" style={{ font: '400 15px/1.4 var(--font-sans)' }}>{a.strength}</span></div>
              </div>
            )}
            {fixesShown.map((t, i) => (
              <div key={i} className="tint cool hstack start" style={{ gap: 10, padding: 12, animation: 'mock-in .32s var(--ease-standard)' }}>
                <span className="none mono" style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--m-cool-fill)', color: 'var(--m-on-cool)', display: 'grid', placeItems: 'center', font: '700 12px/1 var(--font-sans)' }}>{i + 1}</span>
                <div className="stack g2"><span className="label cool">Fix {i + 1}</span><span className="pretty" style={{ font: '400 15px/1.4 var(--font-sans)' }}>{t}</span></div>
              </div>
            ))}
            {shown >= total && (
              <div className="hstack between" style={{ gap: 12, padding: '4px 2px', animation: 'mock-in .32s var(--ease-standard)' }}>
                <span className="label">{Q.lp} verdict</span>
                <span className="chip lg none" style={{ background: d.vBg, color: d.vFg, border: d.vBorder }}><span>{d.vGlyph}</span>{d.vLabel}</span>
              </div>
            )}
            {coachTyping && <div className="hstack sub" style={{ font: '500 13px/1.2 var(--font-sans)' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--m-cool)', animation: 'mock-idle 1.2s ease-in-out infinite' }} />Coach is speaking…</div>}
          </div>
        )}

        {isEnd && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0, overflow: 'auto' }}>
            <div className="stack g4"><span className="label">Session {sessionNo} · {modeLabel}</span><span style={{ font: '800 30px/1.1 var(--font-sans)', letterSpacing: '-.025em' }}>{mode === 'loop' ? 'Loop complete.' : 'Session complete.'}</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {[[p.recapDuration || '48:12', 'duration'], [p.recapCount ?? 5, 'questions'], [p.recapFixes ?? 3, 'fixes to drill']].map(([n, l]) => (
                <div key={l} className="card stack g2" style={{ padding: '10px 12px', borderRadius: 12 }}><span className="mono" style={{ font: '500 22px/1 var(--font-mono)' }}>{n}</span><span className="sub" style={{ fontSize: 11 }}>{l}</span></div>
              ))}
            </div>
            {recapSrc.length > 0 && (
              <div className="list r12">
                {recapSrc.map((r, i) => { const x = v(r.v); return (
                  <div key={i} className="row" style={{ padding: '9px 12px' }}>
                    <span className="avatar lg">{r.mono}</span>
                    <div className="stack grow" style={{ gap: 1 }}><span className="ellipsis" style={{ font: '600 13px/1.2 var(--font-sans)' }}>{r.lp}</span><span className="sub" style={{ fontSize: 11 }}>{r.name} · {r.role}</span></div>
                    <span className="chip none" style={{ background: x.vBg, color: x.vFg, border: x.vBorder }}><span>{x.vGlyph}</span>{x.vLabel}</span>
                  </div>
                ); })}
              </div>
            )}
            <div className="tint cool stack g2"><span className="label cool">Suggested focus · session {sessionNo + 1}</span><span className="pretty" style={{ font: '600 14px/1.35 var(--font-sans)' }}>{p.focus || 'Dive Deep — quantify the blast radius before you describe the fix.'}</span></div>
          </div>
        )}
      </div>

      {hint && (
        <div className="hstack" style={{ margin: '0 20px 10px', gap: 10, padding: '10px 8px 10px 12px', borderRadius: 12, background: 'var(--m-card)', border: '1px solid var(--m-warm-line)', animation: 'mock-in .32s var(--ease-standard)' }}>
          <span className="none" style={{ color: 'var(--m-warm)' }}><Icon.Bulb size={18} /></span>
          <span className="grow" style={{ font: '500 13px/1.35 var(--font-sans)' }}>{Q.hint}</span>
          <button className="icon-btn xs" aria-label="Dismiss hint" onClick={act('dismissHint')}><Icon.Close size={16} /></button>
        </div>
      )}

      {nOpen && (isInterviewer || isMine) && (
        <div className="list r12" style={{ margin: '0 20px 10px', animation: 'mock-in .32s var(--ease-standard)' }}>
          <button className="row" style={{ padding: '10px 12px', justifyContent: 'space-between' }} onClick={() => setNOpen(false)}><span className="label" style={{ color: 'var(--m-fg2)' }}>Story notes{Q.lp ? ' · ' + Q.lp : ''}</span><Icon.Up size={16} /></button>
          {Q.notes.length === 0 && <div className="row sub" style={{ padding: '8px 12px' }}>No stories mapped to this LP yet.</div>}
          {Q.notes.map((n, i) => <div key={i} className="row" style={{ padding: '8px 12px', justifyContent: 'space-between', alignItems: 'baseline' }}><span style={{ font: '600 13px/1.3 var(--font-sans)' }}>{n.t}</span><span className="mono" style={{ font: '500 12px/1.3 var(--font-mono)', color: 'var(--m-warm)', textAlign: 'right' }}>{n.n}</span></div>)}
        </div>
      )}

      {showHandles && (
        <>
          <div className="hstack" style={{ padding: '0 20px 10px' }}>
            <button className="btn sm grow" style={{ height: 34, fontWeight: 500, color: 'var(--m-fg2)' }} onClick={() => setTOpen(!tOpen)}>Transcript · {Q.turns.length} turns<Icon.Up size={14} /></button>
            {!nOpen && <button className="btn sm" style={{ height: 34, fontWeight: 500, color: 'var(--m-fg2)' }} onClick={() => setNOpen(true)}>Notes</button>}
            <button className="btn sm" style={{ height: 34, fontWeight: 500, color: 'var(--m-fg2)' }} onClick={act('hint')}>Hint</button>
          </div>
          <div className="muted" style={{ display: 'flex', justifyContent: 'center', padding: '0 20px 8px', font: '500 12px/1.3 var(--font-sans)', textAlign: 'center' }}>Hands-free: say “redo”, “next” or “hint”. Coaching starts when you stop talking.<span className="desk-only" style={{ display: 'inline', marginLeft: 4 }}> Keys: Space pause · R redo · N next · H hint · Esc end.</span></div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 22, padding: '0 12px calc(env(safe-area-inset-bottom) + 22px)' }}>
            {roundBtn('Redo', <Icon.Redo size={22} />, act('redo'))}
            {roundBtn('Pause', <Icon.Pause size={28} />, act('pause'), true)}
            {roundBtn('Next', <Icon.Next size={22} />, act('next'))}
          </div>
        </>
      )}

      {isCoaching && (
        <div className="hstack" style={{ gap: 10, padding: '6px 20px calc(env(safe-area-inset-bottom) + 20px)' }}>
          <button className="btn lg cool grow" onClick={act('redo')}><Icon.Redo size={18} />Redo answer</button>
          <button className="btn lg grow" style={{ flexDirection: 'column', gap: 3 }} onClick={act('next')}>Next question<span className="muted" style={{ font: '500 11px/1 var(--font-sans)' }}>{nextAuto}</span></button>
        </div>
      )}

      {isEnd && (
        <div className="stack g10" style={{ padding: '6px 20px calc(env(safe-area-inset-bottom) + 20px)' }}>
          <button className="btn lg primary" onClick={act('restart')}>Start session {sessionNo + 1}</button>
          <button className="btn" onClick={onReview}>Review in History</button>
        </div>
      )}

      {isPaused && (
        <div style={{ position: 'absolute', inset: 0, background: 'var(--m-scrim)', backdropFilter: 'blur(3px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 28, zIndex: 5 }}>
          <span className="label hstack" style={{ color: 'var(--m-fg2)' }}><Icon.MicOff size={14} />Mic off · timer held</span>
          <span style={{ font: '800 40px/1 var(--font-sans)', letterSpacing: '-.03em', color: 'var(--m-fg)' }}>Paused</span>
          <span className="mono" style={{ font: '500 28px/1 var(--font-mono)', color: 'var(--m-fg2)' }}>{fmt(sec)}</span>
          <button className="btn xl primary block" style={{ marginTop: 12, maxWidth: 420, height: 60, fontSize: 17 }} onClick={act('resume')}><Icon.Play size={20} />Resume</button>
          <button className="btn ghost danger" style={{ height: 44 }} onClick={act('end')}>End session</button>
        </div>
      )}

      {tOpen && !isEnd && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 112, background: 'var(--m-card)', borderRadius: '24px 24px 0 0', borderTop: '1px solid var(--m-line)', display: 'flex', flexDirection: 'column', zIndex: 6, boxShadow: 'var(--shadow-3)', animation: 'mock-in .32s var(--ease-standard)' }}>
          <div className="hstack between" style={{ padding: '10px 12px 8px 20px' }}><span style={{ font: '700 15px/1.2 var(--font-sans)' }}>Transcript</span><button className="icon-btn" aria-label="Close transcript" onClick={() => setTOpen(false)}><Icon.Close size={18} /></button></div>
          <div style={{ margin: '0 16px', padding: '10px 12px', borderRadius: 10, background: 'var(--m-bg)', borderLeft: '3px solid ' + accentFg }}><div className="label" style={{ fontSize: 10, marginBottom: 3 }}>{Q.label} · pinned</div><div className="pretty" style={{ font: '600 14px/1.3 var(--font-sans)' }}>{Q.text}</div></div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px 24px' }}>{turns.length ? turns : <span className="sub" style={{ textAlign: 'center', padding: 12 }}>Nothing said yet.</span>}</div>
        </div>
      )}
    </div>
  );
}
