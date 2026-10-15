// Mock — the prep canvas. A question; the candidate picks the area it tests; once the pick is
// right they answer out loud and the AI marks every phrase as it is heard (green on track,
// amber drifting, red redo), live captions included. A whiteboard sits under the answer and the
// AI chat is always at the side: type to it, or just talk while no answer is running. In a Meet
// call it runs as the add-on's main stage (canvas/addon.ts) and can hear the call through the
// Meet Media API; outside Meet it hears the mic. State and rules: domain/canvas.ts.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { Icon, Input, Seg, download } from '../components/ui.tsx';
import Whiteboard from '../components/Whiteboard.tsx';
import {
  addChat, addNote, addPhrases, addStroke, canvasQuestions, clearBoard, editNote, emptyCanvas, markPhrase, moveNote, nextQuestion,
  pickArea, referenceFor, removeNote, splitPhrases, summarize, undoStroke, withQuestion, type CanvasState, type Phrase,
} from '../domain/canvas.ts';
import { stackOf, browserStt } from '../domain/providers.ts';
import { chatModel } from '../live/make-pipeline.ts';
import { chatReply, judgePhrase, type CoachContext } from '../canvas/coach.ts';
import { LiveEar, SpeechEar, earAudio, type Ear } from '../canvas/ear.ts';
import { ADDON, SharedCanvas, mainStage, meetingLink, sidePanel } from '../canvas/addon.ts';
import { CanvasLog } from '../canvas/session.ts';
import { boardPng } from '../canvas/board-image.ts';
import { sessionMarkdown } from './History.tsx';
import type { Session } from '../domain/types.ts';
import { BrowserStt, SegmentedStt, elevenLabsTranscriber, geminiTranscriber } from '../speech/stt.ts';
import { meet } from '../meet/meet.ts';
import { MEDIA_SCOPES, type MeetMediaListener } from '../meet/media-api.ts';
import { buildClientId, signInWithGoogle } from '../meet/google.ts';
import { DEFAULT_BOT_NAME } from '../meet/protocol.ts';
import '../styles/screens/canvas.css';

/** A stretch of speech ends after this much quiet: short, so marks land while the candidate talks. */
const PAUSE_MS = 900;
const REVIEW_ASK = 'I finished my answer. How was it? One line on what worked, one on what to fix first.';

type Hearing = 'mic' | 'meet';
/** A sitting just saved to History. */
interface Saved { session: Session; recording: Blob | null; answers: number }

const clock = (ms: number): string => { const t = Math.max(0, Math.floor(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const extOf = (mime: string | null): string => (mime?.includes('ogg') ? 'ogg' : mime?.includes('mp4') ? 'm4a' : 'webm');
/** Typing in a field never triggers the canvas keys. */
const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
type EarState = 'off' | 'starting' | 'on' | 'muted';

const MARK_LABEL: Record<Phrase['mark'], string> = { match: 'on track', drift: 'drifting', redo: 'redo', pending: 'judging…' };

/** `addon`: inside Meet, in the add-on's side panel (just this person) or on the main stage (the whole call). `extra`: shown under the header. */
export default function Canvas({ addon, extra }: { addon?: 'side' | 'stage'; extra?: React.ReactNode }) {
  const { data, repo, refresh, gemini, setGemini, providers, toast, go } = useApp();
  const { lps, stories, questions, settings } = data;
  const [s, setS] = useState<CanvasState>(emptyCanvas);
  const sRef = useRef(s);
  const update = useCallback((f: (x: CanvasState) => CanvasState) => { const next = f(sRef.current); sRef.current = next; setS(next); }, []);
  // The sitting being saved to History (from Listen to Stop), and the one just saved.
  const log = useRef<CanvasLog | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  // Clocks: the sitting and the answer. `tick` re-renders them every second.
  const [t0, setT0] = useState(0);
  const [answerT0, setAnswerT0] = useState(0);
  const [, setTick] = useState(0);

  const areaIds = useMemo(() => new Set(lps.map((l) => l.id)), [lps]);
  const pool = useMemo(() => canvasQuestions(questions, areaIds), [questions, areaIds]);
  const seen = useRef(new Set<string>());
  const question = questions.find((q) => q.id === s.questionId) ?? null;

  const deal = useCallback((countDone: boolean) => {
    const q = nextQuestion(pool, seen.current);
    if (!q) return;
    const cur = sRef.current;
    log.current?.endAnswer(cur.phase === 'answer' ? cur.phrases : []);
    seen.current.add(q.id);
    update((x) => withQuestion({ ...x, done: x.done + (countDone ? 1 : 0) }, q));
  }, [pool, update]);
  useEffect(() => { if (!sRef.current.questionId && pool.length) deal(false); }, [pool, deal]);

  // ---------- The AI ----------
  const prov = providers.settings;
  const model = useMemo(() => {
    const stack = stackOf(prov);
    if (stack.llm === 'openai') return prov.openai.baseUrl.trim() ? chatModel(stack, prov, providers.keys, gemini.key, settings.textModel) : null;
    return gemini.key ? chatModel(stack, prov, providers.keys, gemini.key, settings.textModel) : null;
  }, [prov, providers.keys, gemini.key, settings.textModel]);
  const ctx: CoachContext = useMemo(() => {
    const r = referenceFor(s.areaId, lps, stories, s.questionText);
    return { question: s.questionText, area: r.area, story: r.story, words: r.words };
  }, [s.areaId, s.questionText, lps, stories]);
  const live = useRef({ model, ctx }); live.current = { model, ctx };
  const warned = useRef(false);
  const judging = useRef<Promise<void>>(Promise.resolve());
  const chatting = useRef<Promise<void>>(Promise.resolve());
  const [thinking, setThinking] = useState(false);

  const judge = useCallback((added: Phrase[]) => {
    for (const ph of added) {
      judging.current = judging.current.then(async () => {
        if (!sRef.current.phrases.some((p) => p.id === ph.id)) return; // redone or moved on
        const before = sRef.current.phrases.filter((p) => p.id !== ph.id && p.mark !== 'pending').map((p) => p.text);
        const r = await judgePhrase({ model: live.current.model, ctx: live.current.ctx, before, phrase: ph.text }).catch(() => null);
        if (!r) return;
        if (r.error && !warned.current) { warned.current = true; toast('The AI could not mark that (' + r.error + ') · marking offline'); }
        update((x) => markPhrase(x, ph.id, r.mark, r.note, r.by));
      });
    }
  }, [toast, update]);

  const askAi = useCallback((ask?: string) => {
    chatting.current = chatting.current.then(async () => {
      setThinking(true);
      try {
        const r = await chatReply({ model: live.current.model, state: sRef.current, ctx: live.current.ctx, ask });
        if (r.error && !warned.current) { warned.current = true; toast('The AI is unavailable (' + r.error + ') · answering offline'); }
        update((x) => addChat(r.notes.reduce((y, n) => addNote(y, n, 'ai'), x), 'ai', r.text));
        log.current?.say('coach', r.text);
      } finally { setThinking(false); }
    });
  }, [toast, update]);

  // ---------- Hearing ----------
  const [hearing, setHearing] = useState<Hearing>(addon ? 'meet' : 'mic');
  const [earState, setEarState] = useState<EarState>('off');
  const [level, setLevel] = useState(0);
  const [meetCode, setMeetCode] = useState('');
  const ear = useRef<Ear | null>(null);
  const listener = useRef<MeetMediaListener | null>(null);
  const callUrl = meetCode ? meetingLink(meetCode) : meet.meetingUrl;

  const heard = useCallback((text: string) => {
    const cur = sRef.current;
    log.current?.say('me', text);
    if (cur.phase === 'answer') {
      const { state, added } = addPhrases(cur, splitPhrases(text));
      sRef.current = state; setS(state);
      judge(added);
    } else {
      update((x) => addChat({ ...x, partial: '' }, 'me', text, true));
      askAi();
    }
  }, [judge, askAi, update]);

  const micRec = useRef<MediaStream | null>(null);
  const finishLog = useCallback(async (): Promise<Saved | null> => {
    const l = log.current; log.current = null;
    if (!l) return null;
    const cur = sRef.current;
    const r = await l.finish(cur.phase === 'answer' ? cur.phrases : []).catch(() => null);
    micRec.current?.getTracks().forEach((t) => t.stop()); micRec.current = null;
    return r;
  }, []);
  const stopEar = useCallback(() => {
    ear.current?.close(); ear.current = null;
    listener.current?.close(); listener.current = null;
    setEarState('off'); setLevel(0);
  }, []);
  const stop = useCallback(async () => {
    stopEar();
    const r = await finishLog();
    if (r) { setSaved(r); void refresh(); toast('Session ' + r.session.number + ' saved to History'); }
  }, [stopEar, finishLog, refresh, toast]);
  const stopRef = useRef(stop); stopRef.current = stop;
  useEffect(() => () => { void stopRef.current(); }, []);

  const makeEar = (input: MediaStream | null): Ear => {
    const keys = providers.keys;
    if (prov.stt === 'elevenlabs' && keys.elevenlabs) return new SpeechEar(new SegmentedStt({ pauseMs: PAUSE_MS, transcribe: elevenLabsTranscriber({ key: keys.elevenlabs, model: prov.elevenlabs.sttModel }) }), earAudio(input));
    if (prov.stt === 'gemini' && gemini.key) return new LiveEar({ key: gemini.key, model: settings.liveModel, voice: settings.voice, pauseMs: PAUSE_MS, audio: earAudio(input) });
    // Chrome's recogniser only hears the mic.
    if (!input && browserStt()) return new SpeechEar(new BrowserStt({ pauseMs: PAUSE_MS, lang: prov.browser.lang }), null);
    if (gemini.key) return new SpeechEar(new SegmentedStt({ pauseMs: PAUSE_MS, transcribe: geminiTranscriber({ key: gemini.key, model: settings.textModel }) }), earAudio(input));
    throw new Error(input ? 'Hearing a call needs a Gemini or ElevenLabs key' : 'Add a Gemini key, or pick Chrome speech in Settings · Voice & model');
  };

  const listen = async () => {
    setEarState('starting');
    try {
      let input: MediaStream | null = null;
      if (hearing === 'meet') {
        if (!callUrl) throw new Error('No Meet call: open the canvas from the Meet add-on, or invite Mock to a call first');
        const l = meet.mediaListenerFor(callUrl, meet.inCall() ? DEFAULT_BOT_NAME : '');
        if (!l) throw new Error('Sign in with Google to hear the call');
        listener.current = l;
        l.onEnd = (why) => { toast('The call stopped sending audio (' + why + ')'); void stop(); };
        input = await l.connect();
      }
      const e = makeEar(input);
      e.onPartial = (t) => update((x) => (x.partial === t ? x : { ...x, partial: t }));
      e.onFinal = heard;
      e.onLevel = setLevel;
      e.onError = (m) => toast(m);
      ear.current = e;
      await e.start();
      e.setListening(true);
      setEarState('on');
      if (driverRef.current && !log.current) {
        // Record what the canvas hears: the call, or (beside the recogniser) the mic.
        const l = await CanvasLog.begin(repo, { meet: !!input });
        log.current = l; setSaved(null);
        let rec = input;
        if (!rec) { try { rec = micRec.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { rec = null; } }
        l.record(rec);
        const cur = sRef.current;
        if (cur.phase === 'answer') l.startAnswer({ questionId: cur.questionId || null, questionText: cur.questionText, lpId: cur.areaId });
        setT0(Date.now());
      }
    } catch (err) {
      void stop();
      toast((err as Error).message || 'Could not start listening');
    }
  };
  const toggleMute = () => {
    const on = earState !== 'on';
    ear.current?.setListening(on);
    log.current?.pauseRecording(!on);
    setEarState(on ? 'on' : 'muted');
    if (!on) setLevel(0);
  };

  const [signingIn, setSigningIn] = useState(false);
  const googleSignIn = async () => {
    setSigningIn(true);
    try { const id = meet.saved.clientId || buildClientId(); meet.setMediaToken(await signInWithGoogle(id, MEDIA_SCOPES)); toast('Signed in · the canvas can hear the call'); }
    catch (err) { toast((err as Error).message); }
    setSigningIn(false);
  };

  // ---------- Meet add-on: share the canvas with the call ----------
  const [driver, setDriver] = useState(true);
  const driverRef = useRef(true); driverRef.current = driver;
  const shared = useRef<SharedCanvas | null>(null);
  useEffect(() => {
    if (!addon) return;
    let alive = true;
    if (addon === 'side') {
      // The side panel is this person's own canvas: only the meeting code is needed (to hear the call).
      sidePanel(ADDON.project).then((c) => c.getMeetingInfo()).then((info) => { if (alive) setMeetCode(info.meetingCode); }, (err) => toast('Meet add-on: ' + ((err as Error).message || 'could not connect')));
      return () => { alive = false; };
    }
    const sc = new SharedCanvas();
    void (async () => {
      try {
        const client = await mainStage(ADDON.project);
        const [reason, info] = await Promise.all([client.getFrameOpenReason(), client.getMeetingInfo()]);
        if (!alive) return;
        setMeetCode(info.meetingCode);
        if (reason === 'JOIN_ACTIVITY') setDriver(false);
        sc.onState = (st) => { if (!driverRef.current) { sRef.current = st; setS(st); } };
        await sc.connect(ADDON.project);
        if (alive) shared.current = sc;
      } catch (err) { toast('Meet add-on: ' + ((err as Error).message || 'could not connect')); }
    })();
    return () => { alive = false; sc.close(); shared.current = null; };
  }, [addon, toast]);
  useEffect(() => { if (driver) shared.current?.share(s); }, [s, driver]);

  // ---------- Actions ----------
  const pick = (areaId: string) => {
    if (!question || !driver) return;
    const area = lps.find((l) => l.id === areaId);
    const r = pickArea(sRef.current, question, areaId);
    if (r.ok) {
      const primary = lps.find((l) => l.id === question.lpIds[0]);
      const line = r.role === 'secondary' && primary
        ? `Yes, ${area?.name} fits as a secondary area; the main one is ${primary.name}. Answer out loud when you are ready.`
        : `Yes, ${area?.name}. Answer out loud when you are ready; I mark each phrase as you go.`;
      update(() => addChat(r.state, 'ai', line));
      log.current?.startAnswer({ questionId: question.id, questionText: question.text, lpId: areaId });
      log.current?.say('coach', line);
      setAnswerT0(Date.now());
    } else {
      // One hint, then one nudge to "Show me"; further misses only show on the buttons.
      const n = r.state.misses.length;
      const hint = n === 1 ? `Not ${area?.name ?? 'that one'}. What would the interviewer write at the top of their notes for this question?`
        : n === 2 ? 'Still not it. Think about the behaviour the question asks for, or tap Show me.' : '';
      update(() => (hint && n > sRef.current.misses.length ? addChat(r.state, 'ai', hint) : r.state));
    }
  };
  const reveal = () => { if (question) pick(question.lpIds.find((id) => areaIds.has(id)) ?? question.lpIds[0]); };
  const finish = () => {
    if (sRef.current.phase !== 'answer' || !sRef.current.phrases.length) return;
    log.current?.endAnswer(sRef.current.phrases);
    update((x) => ({ ...x, phase: 'done', partial: '' }));
    askAi(REVIEW_ASK);
  };
  const redo = () => {
    const cur = sRef.current;
    if (!cur.phrases.length) return;
    // The attempt stays in History; the redo is a new one.
    log.current?.endAnswer(cur.phase === 'answer' ? cur.phrases : []);
    log.current?.startAnswer({ questionId: cur.questionId || null, questionText: cur.questionText, lpId: cur.areaId });
    update((x) => ({ ...x, phase: 'answer', phrases: [], partial: '' }));
    setAnswerT0(Date.now());
  };
  const [typed, setTyped] = useState('');
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = typed.trim(); if (!t) return;
    setTyped('');
    update((x) => addChat(x, 'me', t));
    log.current?.say('me', t);
    askAi();
  };

  // Keys: L listen (then mute and unmute), F finish, R redo, N next question. Never while typing.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || readOnly) return;
    const k = e.key.toLowerCase();
    if (k === 'l') { if (earState === 'off') void listen(); else if (earState !== 'starting') toggleMute(); }
    else if (k === 'f' && s.phase === 'answer') finish();
    else if (k === 'r' && s.phase !== 'pick') redo();
    else if (k === 'n' && s.phase !== 'pick') deal(true);
    else return;
    e.preventDefault();
  };
  useEffect(() => { const on = (e: KeyboardEvent) => keys.current(e); window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on); }, []);
  const ticking = earState !== 'off' || s.phase === 'answer';
  useEffect(() => { if (!ticking) return; const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, [ticking]);
  const recording = !!log.current;

  const saveBoard = async () => {
    try { download('mock-board-' + new Date().toISOString().slice(0, 10) + '.png', await boardPng(s.notes, s.strokes)); }
    catch (err) { toast((err as Error).message); }
  };
  const downloadRecording = () => { if (saved?.recording) download('mock-session-' + saved.session.number + '.' + extOf(saved.session.recordingMime), saved.recording); };
  const downloadTranscript = async () => {
    if (!saved) return;
    const [xs, events] = await Promise.all([repo.exchanges(saved.session.id), repo.transcript(saved.session.id)]);
    download('mock-session-' + saved.session.number + '.md', new Blob([sessionMarkdown(saved.session, 'Canvas', xs, [], events)], { type: 'text/markdown' }));
  };

  // Only the message list scrolls to the newest message (scrolling the page would pull the phone layout away from the answer).
  const msgs = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = msgs.current; if (el) el.scrollTop = el.scrollHeight; }, [s.chat.length, thinking, s.partial]);

  const sum = summarize(s.phrases);
  const latest = [...s.phrases].reverse().find((p) => p.mark !== 'pending' && p.note);
  const readOnly = !driver;
  const noAi = !model;

  if (!pool.length) {
    const loadPreset = async () => { await repo.loadSample(); await refresh(); toast('AWS interview defaults loaded'); };
    return (
      <div className="screen canvas">
        <CanvasHead addon={!!addon} onBack={() => go(paths.practice)} />
        <div className="screen-body">
          <div className="card pad-lg stack g10 cv-empty">
            <span className="h3">No tagged questions yet</span>
            <span className="sub pretty">The canvas asks questions tagged with an area, so it can tell whether your pick is right. Tag questions in the Library, or load the AWS preset.</span>
            <div className="hstack">
              <button className="btn primary" onClick={() => void loadPreset()}>Load the AWS preset</button>
              {!addon && <button className="btn" onClick={() => go(paths.library('questions'))}>Open the Library</button>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen canvas" data-phase={s.phase} data-ear={earState}>
      <CanvasHead addon={!!addon} onBack={() => go(paths.practice)}>
        {readOnly ? (
          <span className="hstack"><span className="sub">Watching the canvas</span><button className="btn sm" onClick={() => setDriver(true)}>Take over</button></span>
        ) : (
          <div className="cv-ear">
            {(addon || meet.inCall()) && earState === 'off' && <Seg<Hearing> value={hearing} onChange={setHearing} options={[['mic', 'Mic'], ['meet', 'Meet call']]} />}
            {hearing === 'meet' && earState === 'off' && !meet.hasMediaToken() && <button className="btn sm" disabled={signingIn} onClick={() => void googleSignIn()}>{signingIn ? 'Signing in…' : 'Sign in with Google'}</button>}
            {earState === 'off' || earState === 'starting'
              ? <button className="btn sm cool" disabled={earState === 'starting'} onClick={() => void listen()}><Icon.Mic size={16} />{earState === 'starting' ? 'Starting…' : 'Listen'}</button>
              : (
                <>
                  {recording && <span className={'cv-rec' + (earState === 'muted' ? ' paused' : '')} role="status" aria-label={'Recording, ' + clock(Date.now() - t0)}><i />{clock(Date.now() - t0)}</span>}
                  <span className="cv-level" aria-hidden="true"><i style={{ transform: `scaleY(${0.15 + Math.min(1, level * 2.5) * 0.85})` }} /></span>
                  <button className="btn sm" aria-pressed={earState === 'on'} onClick={toggleMute}>{earState === 'on' ? <><Icon.Mic size={16} />Listening</> : <><Icon.MicOff size={16} />Muted</>}</button>
                  <button className="text-btn" onClick={() => void stop()}>{recording ? 'Stop & save' : 'Stop'}</button>
                </>
              )}
          </div>
        )}
      </CanvasHead>
      {extra}
      {saved && (
        <div className="cv-saved" role="status">
          <Icon.Check size={16} />
          <span className="grow">Session {saved.session.number} saved · {saved.answers} {saved.answers === 1 ? 'answer' : 'answers'}{saved.recording ? ' · recording' : ''}</span>
          {saved.recording && <button className="btn sm" onClick={downloadRecording}><Icon.Download size={14} />Recording</button>}
          <button className="btn sm" onClick={() => void downloadTranscript()}><Icon.Download size={14} />Transcript</button>
          {!addon && <button className="btn sm" onClick={() => go(paths.session(saved.session.id))}>Open in History</button>}
          <button className="wb-x" aria-label="Dismiss" onClick={() => setSaved(null)}>×</button>
        </div>
      )}
      {addon && !gemini.hasKey && prov.llm === 'gemini' && (
        <div className="cv-key">
          <Input label="Gemini API key (kept in this browser)" mono type="password" placeholder="AIza…" onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') void setGemini({ key: e.currentTarget.value.trim() }); }} />
        </div>
      )}

      <div className="cv-body">
        <main className="cv-stage">
          <section className="card pad-lg cv-q" aria-label="Question">
            <div className="hstack between">
              <span className="label">Question {s.done + 1}</span>
              {!readOnly && <button className="text-btn" onClick={() => deal(false)}>Skip</button>}
            </div>
            <p className="cv-q-text">{s.questionText}</p>
          </section>

          {s.phase === 'pick' ? (
            <section className="stack g8" aria-label="Pick the area">
              <div className="hstack between"><span className="label">Which area does it test?</span>{s.misses.length >= 2 && !readOnly && <button className="text-btn" onClick={reveal}>Show me</button>}</div>
              <div className="cv-areas" role="group" aria-label="Areas">
                {lps.map((l) => (
                  <button key={l.id} type="button" className={'cv-area' + (s.misses.includes(l.id) ? ' wrong' : '')} disabled={readOnly || s.misses.includes(l.id)} onClick={() => pick(l.id)}>{l.name}</button>
                ))}
              </div>
            </section>
          ) : (
            <section className={'card pad-lg cv-answer' + (sum.overall ? ' ' + sum.overall : '')} aria-label="Your answer">
              <div className="hstack between wrap">
                <span className="hstack"><span className="label">Your answer</span><span className="cv-area-pill">{ctx.area?.name}{s.role === 'secondary' ? ' · secondary' : ''}</span>{s.phase === 'answer' && answerT0 > 0 && <AnswerClock ms={Date.now() - answerT0} />}</span>
                <span className="cv-legend" aria-label="Colours"><span className="match">on track {sum.match}</span><span className="drift">drifting {sum.drift}</span><span className="redo">redo {sum.redo}</span></span>
              </div>
              <p className="cv-words" aria-live="polite" data-testid="cv-words">
                {s.phrases.map((p) => <span key={p.id} className={'cv-ph ' + p.mark} title={MARK_LABEL[p.mark] + (p.note ? ' · ' + p.note : '')} data-mark={p.mark}>{p.text} </span>)}
                {s.phase === 'answer' && s.partial && <span className="cv-ph live">{s.partial}</span>}
                {!s.phrases.length && !s.partial && <span className="cv-hint">{earState === 'on' ? 'Listening… start with the situation.' : 'Press Listen, then answer out loud.'}</span>}
              </p>
              <div className={'cv-sum ' + (sum.overall ?? 'none')} role="status">
                <span>{sum.line}</span>
                {latest && <span className="cv-note">{latest.note}{latest.by === 'local' ? ' · offline' : ''}</span>}
              </div>
              {!readOnly && (
                <div className="hstack wrap">
                  {s.phase === 'answer'
                    ? <button className="btn sm primary" disabled={!s.phrases.length} onClick={finish}><Icon.Check size={16} />Finish answer</button>
                    : <button className="btn sm primary" onClick={() => deal(true)}><Icon.Next size={16} />Next question</button>}
                  <button className={'btn sm' + (sum.overall === 'redo' ? ' danger' : '')} onClick={redo} disabled={!s.phrases.length}><Icon.Redo size={16} />Redo</button>
                  {s.phase === 'answer' && <button className="text-btn" onClick={() => deal(true)}>Next question</button>}
                </div>
              )}
            </section>
          )}

          <section className="stack g8" aria-label="Whiteboard">
            <span className="label">Whiteboard</span>
            <Whiteboard
              notes={s.notes} strokes={s.strokes} readOnly={readOnly}
              onStroke={(p) => update((x) => addStroke(x, p, 'me'))}
              onAddNote={(t) => update((x) => addNote(x, t, 'me'))}
              onMoveNote={(id, x, y) => update((st) => moveNote(st, id, x, y))}
              onEditNote={(id, t) => update((x) => editNote(x, id, t))}
              onRemoveNote={(id) => update((x) => removeNote(x, id))}
              onClear={() => update(clearBoard)}
              onUndo={() => update(undoStroke)}
              onSave={() => void saveBoard()}
            />
          </section>
          {!readOnly && <p className="cv-keys sub" aria-hidden="true"><kbd>L</kbd> listen · <kbd>F</kbd> finish · <kbd>R</kbd> redo · <kbd>N</kbd> next{recording ? ' · recording to History' : ' · Listen records the sitting to History'}</p>}
        </main>

        <aside className="cv-chat" aria-label="Chat with the AI">
          <div className="cv-chat-head"><span className="label">AI</span><span className="sub">{noAi ? 'offline · add a key in Settings' : 'hears you · type or talk'}</span></div>
          <div className="cv-msgs" role="log" aria-live="polite" ref={msgs}>
            {!s.chat.length && <span className="sub cv-hint">Ask for an outline, a better opening, or what the interviewer wants to hear.</span>}
            {s.chat.map((m) => <div key={m.id} className={'cv-msg ' + m.who}>{m.voice && <Icon.Mic size={12} className="cv-said" />}{m.text}</div>)}
            {s.phase !== 'answer' && s.partial && <div className="cv-msg me live">{s.partial}</div>}
            {thinking && <div className="cv-msg ai typing" aria-label="The AI is writing">…</div>}
          </div>
          {!readOnly && (
            <form className="cv-send" onSubmit={send}>
              <input className="input" aria-label="Message the AI" placeholder="Message the AI…" value={typed} onChange={(e) => setTyped(e.target.value)} />
              <button className="btn sm cool" type="submit" disabled={!typed.trim()}>Send</button>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}

function CanvasHead({ addon, onBack, children }: { addon: boolean; onBack: () => void; children?: React.ReactNode }) {
  return (
    <div className="screen-head cv-head">
      <span className="hstack">
        {!addon && <button className="back-btn" onClick={onBack}><Icon.Back size={18} />Practice</button>}
        <span className="h2">Canvas</span>
      </span>
      {children}
    </div>
  );
}

/** How long the answer has run: gold past two minutes, red past three (most answers want two). */
function AnswerClock({ ms }: { ms: number }) {
  const tone = ms >= 180_000 ? ' long' : ms >= 120_000 ? ' warn' : '';
  return <span className={'cv-clock mono' + tone} title="Aim for about two minutes">{clock(ms)}</span>;
}
