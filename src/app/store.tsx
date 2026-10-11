// Mock — the app store. One context carries the repository reads, derived rows, UI
// preferences, navigation, toasts, the Gemini configuration and the live session. Screens
// read what they need with `useApp()`; writes go through `repo` and then `refresh()`.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Exchange, Lp, PrepFile, Question, Session, Settings, Story, TranscriptEvent, UiPrefs } from '../domain/types.ts';
import type { Repo, RepoMode } from '../db/repo.ts';
import { MemoryRepo } from '../db/memory.ts';
import { lpRows, storyRows, questionRows, coveredLpIds, heatmap, trend, weakestAnswer, type LpRow, type StoryRow, type QuestionRow } from '../domain/selectors.ts';
import type { SessionState } from '../domain/session-machine.ts';
import { SessionController, type ControllerMeta, type StartOptions } from '../live/controller.ts';
import { SimulatedTransport } from '../live/simulated.ts';
import { analysisPipeline } from '../gemini/setup.ts';
import { DEMO_SCRIPT } from '../live/scripts/demo.ts';
import { INTERVIEWERS } from '../fixtures/sample.ts';
import { buildContext, confirmTokens, prioritiseQuestions } from '../live/context.ts';
import { GeminiLiveTransport } from '../live/gemini.ts';
import { BrowserAudio } from '../live/audio.ts';
import { countTokens } from '../live/gemini-rest.ts';
import { readPrefs, writePrefs } from './prefs.ts';
import { DEFAULT_PRICING } from '../domain/budget.ts';
import { setUsageSink } from '../gemini/usage.ts';
import type { UsageEntry } from '../db/repo.ts';
import { applyTheme } from './theme.ts';
import { go as routerGo, back as routerBack, useRoute, type Route } from './router.ts';

export interface AppData {
  lps: Lp[]; stories: Story[]; questions: Question[]; files: PrepFile[]; sessions: Session[]; exchanges: Exchange[]; settings: Settings;
  /** derived */
  lpRows: LpRow[]; storyRows: StoryRow[]; questionRows: QuestionRow[]; covered: Set<string>;
  heat: ReturnType<typeof heatmap>; trend: ReturnType<typeof trend>; weakest: Exchange | null;
}

export interface GeminiConfig { key: string; hasKey: boolean; model: string; voice: string }

export interface LiveStart {
  mode: StartOptions['mode'];
  focus?: string | null;
  focusLabel?: string;
  questionText?: string | null;
  coaching?: Settings['coaching'];
}

export interface AppStore {
  ready: boolean;
  status: string;
  dbMode: RepoMode;
  repo: Repo;
  data: AppData;
  refresh: () => Promise<void>;
  prefs: UiPrefs;
  setPref: <K extends keyof UiPrefs>(k: K, v: UiPrefs[K]) => void;
  route: Route;
  go: (path: string, replace?: boolean) => void;
  back: (fallback: string) => void;
  toast: (message: string) => void;
  toastText: string;
  gemini: GeminiConfig;
  setGemini: (patch: Partial<Pick<GeminiConfig, 'key' | 'model' | 'voice'>>) => Promise<void>;
  live: {
    state: SessionState | null; meta: ControllerMeta | null; controller: SessionController | null;
    /** The options of the running (or last) session, for "Start session N+1". */
    lastStart: LiveStart | null;
    start: (o: LiveStart) => Promise<void>;
    /** Leave the live screen (the controller is destroyed; the session stays saved). */
    exit: () => void;
  };
  transcript: (sessionId: string) => Promise<TranscriptEvent[]>;
  /** Sheets shared across screens (open from Practice, Library, Progress…). */
  sheet: { setup: boolean; answer: QuestionRow | null; addQuestion: boolean; addStory: boolean };
  openSheet: (name: keyof AppStore['sheet'], value?: unknown) => void;
  closeSheets: () => void;
}

const Ctx = createContext<AppStore | null>(null);
export const useApp = (): AppStore => { const v = useContext(Ctx); if (!v) throw new Error('useApp outside AppProvider'); return v; };

function derive(d: Omit<AppData, 'lpRows' | 'storyRows' | 'questionRows' | 'covered' | 'heat' | 'trend' | 'weakest'>): AppData {
  const rows = lpRows(d.lps, d.stories, d.questions, d.sessions, d.exchanges);
  return { ...d, lpRows: rows, storyRows: storyRows(d.stories, d.lps, d.exchanges), questionRows: questionRows(d.questions, d.lps), covered: coveredLpIds(d.stories), heat: heatmap(d.lps, d.sessions, d.exchanges), trend: trend(d.sessions, d.exchanges), weakest: weakestAnswer(d.sessions, d.exchanges) };
}

const EMPTY: AppData = derive({ lps: [], stories: [], questions: [], files: [], sessions: [], exchanges: [], settings: { interviewDate: '2026-10-30', liveModel: 'gemini-3.8-live', textModel: 'gemini-3.8-flash', voice: 'Aoede', pauseMs: 2500, systemInstruction: '', loopSize: 5, coaching: 'after_each', questionSource: 'mix', storyNotes: true, seed: 12345, lastBackupAt: null, onboarded: false, pricing: DEFAULT_PRICING, usage: [], gamePlays: [] } });

export function AppProvider({ repo: given, children }: { repo?: Repo; children: React.ReactNode }) {
  const repo = useMemo(() => given ?? new MemoryRepo(), [given]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Starting…');
  const [dbMode, setDbMode] = useState<RepoMode>('none');
  const [data, setData] = useState<AppData>(EMPTY);
  const [prefs, setPrefs] = useState<UiPrefs>(readPrefs);
  const [toastText, setToastText] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gemini, setGem] = useState<GeminiConfig>({ key: '', hasKey: false, model: 'gemini-3.8-live', voice: 'Aoede' });
  const [liveState, setLiveState] = useState<SessionState | null>(null);
  const [liveMeta, setLiveMeta] = useState<ControllerMeta | null>(null);
  const controller = useRef<SessionController | null>(null);
  const [lastStart, setLastStart] = useState<LiveStart | null>(null);
  const [sheet, setSheet] = useState<AppStore['sheet']>({ setup: false, answer: null, addQuestion: false, addStory: false });
  const route = useRoute();

  const refresh = useCallback(async () => {
    const [lps, stories, questions, files, sessions, exchanges, settings] = await Promise.all([repo.lps(), repo.stories(), repo.questions(), repo.files(), repo.sessions(), repo.exchanges(), repo.settings()]);
    setData(derive({ lps, stories, questions, files, sessions, exchanges, settings }));
    const key = (await repo.getSecret('gemini.key')) ?? '';
    setGem({ key, hasKey: !!key, model: settings.liveModel, voice: settings.voice });
  }, [repo]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const mode = await repo.init((s) => alive && setStatus(s));
      if (!alive) return;
      setDbMode(mode);
      await refresh();
      if (alive) setReady(true);
    })();
    return () => { alive = false; };
  }, [repo, refresh]);

  useEffect(() => { applyTheme(prefs.theme); writePrefs(prefs); }, [prefs]);
  useEffect(() => { setSheet({ setup: false, answer: null, addQuestion: false, addStory: false }); }, [route.path]);
  useEffect(() => { if (route.tab !== prefs.lastTab && ['practice', 'library', 'history', 'progress', 'game'].includes(route.tab)) setPrefs((p) => ({ ...p, lastTab: route.tab })); }, [route.tab]);

  const toast = useCallback((message: string) => {
    setToastText(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(''), 5000);
  }, []);

  const transcript = useCallback((id: string) => repo.transcript(id), [repo]);
  const setPref = useCallback(<K extends keyof UiPrefs>(k: K, v: UiPrefs[K]) => setPrefs((p) => ({ ...p, [k]: v })), []);

  const setGemini = useCallback(async (patch: Partial<Pick<GeminiConfig, 'key' | 'model' | 'voice'>>) => {
    if (patch.key !== undefined) await repo.setSecret('gemini.key', patch.key || null);
    const s: Partial<Settings> = {};
    if (patch.model !== undefined) s.liveModel = patch.model;
    if (patch.voice !== undefined) s.voice = patch.voice;
    if (Object.keys(s).length) await repo.setSettings(s);
    await refresh();
  }, [repo, refresh]);

  const exitLive = useCallback(() => {
    controller.current?.destroy();
    controller.current = null;
    setLiveState(null); setLiveMeta(null);
  }, []);

  const startLive = useCallback(async (o: LiveStart) => {
    exitLive();
    setLastStart(o);
    const s = data.settings;
    // With a key the session runs on Gemini Live; without one, the scripted demo. The audio
    // engine is created before the first await so iOS sees the Start tap as its gesture.
    const demo = !gemini.hasKey;
    const transport = demo
      ? new SimulatedTransport(DEMO_SCRIPT)
      : new GeminiLiveTransport({ auth: { kind: 'key', key: gemini.key }, audio: new BrowserAudio() });
    // With a key the cards and the report come from Flash, falling back to the offline card /
    // local report; the demo replays the script's cards.
    const { analyzer, reporter } = analysisPipeline({ key: demo ? null : gemini.key || null, textModel: s.textModel, lps: data.lps, stories: data.stories, script: demo ? DEMO_SCRIPT : null, onFallback: (what, err) => toast((what === 'analysis' ? 'Flash card failed' : 'Flash report failed') + ' — used the offline one (' + err.message + ')') });
    const c = new SessionController(transport, analyzer, repo, () => Date.now(), demo, { reporter });
    controller.current = c;
    c.subscribe((st, meta) => { setLiveState(st); setLiveMeta(meta); });
    const focusLp = o.mode === 'lp' && o.focus ? data.lps.find((l) => l.id === o.focus) : null;
    const weak = data.lpRows.slice().sort((a, b) => (a.readiness ?? 0.35) - (b.readiness ?? 0.35)).map((l) => l.id);
    const questions = prioritiseQuestions(data.questions, { mode: o.mode, focusLpId: focusLp?.id ?? null, weakLpIds: weak.slice(0, 5) });
    const previous = await repo.reports(8);
    const ctx = buildContext({ sessionNumber: await repo.nextSessionNumber(), date: new Date().toISOString().slice(0, 10), mode: o.mode, focus: o.focusLabel ?? focusLp?.name ?? o.questionText ?? '', coaching: o.coaching ?? s.coaching, questionSource: s.questionSource, previous, lps: data.lps, stories: data.stories, questions, files: data.files, userInstruction: s.systemInstruction });
    c.setContext({ estimated: ctx.estimatedTokens, counted: null, budget: ctx.budget, trimmed: ctx.trimmed });
    if (!demo) void confirmTokens(ctx, (t) => countTokens(gemini.key, s.textModel, t)).then((counted) => { if (counted != null) c.setContext({ estimated: ctx.estimatedTokens, counted, budget: ctx.budget, trimmed: ctx.trimmed }); });
    // Show the connecting screen while the mic is granted and the connection opens.
    setSheet({ setup: false, answer: null, addQuestion: false, addStory: false });
    routerGo('/live');
    await c.start({ mode: o.mode, focus: o.focus ?? null, focusLabel: o.focusLabel ?? focusLp?.name ?? '', coaching: o.coaching ?? s.coaching, questionSource: s.questionSource, storyNotes: s.storyNotes, seed: s.seed, systemInstruction: ctx.text, interviewers: INTERVIEWERS, lps: data.lps, stories: data.stories, pauseMs: s.pauseMs, model: s.liveModel, voice: s.voice, questionText: o.questionText ?? null });
  }, [data, gemini.hasKey, gemini.key, repo, exitLive, toast]);

  // Budget: every Gemini call's tokens go to the ledger, batched so a live session writes at
  // most every two seconds.
  useEffect(() => {
    let pending: UsageEntry[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => { timer = null; const batch = pending; pending = []; void repo.addUsage(batch).catch(() => { /* lost: never break a session over accounting */ }); };
    const off = setUsageSink((model, lpId, usage) => { pending.push({ model, lpId, usage }); timer ??= setTimeout(flush, 2000); });
    const onHide = () => { if (timer) { clearTimeout(timer); flush(); } };
    window.addEventListener('pagehide', onHide);
    return () => { off(); window.removeEventListener('pagehide', onHide); onHide(); };
  }, [repo]);

  // Refresh the library when a live session writes.
  useEffect(() => {
    repo.onChange = () => { void refresh(); };
    return () => { repo.onChange = null; };
  }, [repo, refresh]);

  const value: AppStore = useMemo(() => ({
    ready, status, dbMode, repo, data, refresh, prefs, setPref, route, go: routerGo, back: routerBack, toast, toastText, gemini, setGemini,
    live: { state: liveState, meta: liveMeta, controller: controller.current, lastStart, start: startLive, exit: exitLive },
    transcript,
    sheet,
    openSheet: (name, v) => setSheet((x) => ({ ...x, [name]: name === 'answer' ? (v as QuestionRow) : true })),
    closeSheets: () => setSheet({ setup: false, answer: null, addQuestion: false, addStory: false }),
  }), [ready, status, dbMode, repo, data, refresh, prefs, setPref, route, toast, toastText, gemini, setGemini, liveState, liveMeta, lastStart, startLive, exitLive, sheet, transcript]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
