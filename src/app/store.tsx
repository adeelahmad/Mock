// Mock — the app store. One context carries the repository reads, derived rows, UI
// preferences, navigation, toasts, the Gemini configuration and the live session. Screens
// read what they need with `useApp()`; writes go through `repo` and then `refresh()`.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Exchange, Interviewer, Lp, PrepFile, Question, Session, Settings, Story, TranscriptEvent, UiPrefs } from '../domain/types.ts';
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
import { contextTools } from '../live/context-tools.ts';
import { meet } from '../meet/meet.ts';
import { MeetAudio } from '../meet/meet-audio.ts';
import { KnowledgeIndex, type Hit, type IndexStatus } from '../rag/knowledge.ts';
import { geminiEmbedder, type Embedder } from '../rag/embed.ts';
import { readPrefs, writePrefs, readFlag, writeFlag } from './prefs.ts';
import { DEFAULT_PRICING } from '../domain/budget.ts';
import { DEFAULT_PROVIDERS, isLiveStack, missingFor, stackLabel, stackOf, withProviderDefaults, type ProviderSettings, type VoiceStack } from '../domain/providers.ts';
import { makePipeline, textLlm, type ProviderKeys } from '../live/make-pipeline.ts';
import { SYSTEM_PROMPT_BUDGET } from '../live/context.ts';
import { setUsageSink } from '../gemini/usage.ts';
import type { UsageEntry } from '../db/repo.ts';
import { applyTheme } from './theme.ts';
import { buildBackup } from '../db/backup.ts';
import { SyncEngine, localMemo, type SyncStatus } from '../sync/engine.ts';
import { httpSync, status as serverStatus, type ServerStatus } from '../sync/api.ts';
import { Vault, idbPersist, localSaved, type ServerHint, type VaultStatus } from '../vault/vault.ts';
import { go as routerGo, back as routerBack, useRoute, type Route } from './router.ts';

export interface AppData {
  lps: Lp[]; stories: Story[]; questions: Question[]; files: PrepFile[]; sessions: Session[]; exchanges: Exchange[]; settings: Settings;
  /** derived */
  lpRows: LpRow[]; storyRows: StoryRow[]; questionRows: QuestionRow[]; covered: Set<string>;
  heat: ReturnType<typeof heatmap>; trend: ReturnType<typeof trend>; weakest: Exchange | null;
}

export interface GeminiConfig { key: string; hasKey: boolean; model: string; voice: string }

export interface KnowledgeState {
  status: IndexStatus;
  indexing: boolean;
  error: string | null;
  /** Re-embeds every file from scratch. */
  rebuild: () => Promise<void>;
  search: (query: string, k?: number) => Promise<Hit[]>;
}

export interface LiveStart {
  mode: StartOptions['mode'];
  focus?: string | null;
  focusLabel?: string;
  questionText?: string | null;
  coaching?: Settings['coaching'];
  /** This session's speech in, model and voice out; omitted → the Settings default. */
  stack?: VoiceStack;
}

export interface ProvidersState {
  settings: ProviderSettings;
  keys: ProviderKeys;
  setKey: (name: keyof ProviderKeys, value: string) => Promise<void>;
  save: (patch: Partial<ProviderSettings>) => Promise<void>;
}

export interface Account {
  /** The Mock server behind this site, or null (static hosting / offline / no server). */
  server: ServerStatus | null;
  sync: SyncStatus;
  /** The user chose to use Mock without an account on this device. */
  skipped: boolean;
  skip: (on: boolean) => void;
  /** Re-reads the server status (after setup, sign-in) and starts or stops sync. */
  reload: () => Promise<void>;
  syncNow: () => Promise<void>;
  /** Passphrase sync (src/vault): peer-to-peer, no account needed. */
  vault: Vault;
  vaultStatus: VaultStatus;
  /** What the vault needs to know about the Mock server serving this app (null on a static host). */
  hint: ServerHint | null;
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
  /** Speech-to-text, model and text-to-speech choices, and the keys they need. */
  providers: ProvidersState;
  live: {
    state: SessionState | null; meta: ControllerMeta | null; controller: SessionController | null;
    /** The options of the running (or last) session, for "Start session N+1". */
    lastStart: LiveStart | null;
    start: (o: LiveStart) => Promise<void>;
    /** Leave the live screen (the controller is destroyed; the session stays saved). */
    exit: () => void;
  };
  transcript: (sessionId: string) => Promise<TranscriptEvent[]>;
  /** The knowledge index over the prep files (hints, search_prep). */
  knowledge: KnowledgeState;
  /** Sheets shared across screens (open from Practice, Library, Progress…). */
  sheet: { setup: boolean; answer: QuestionRow | null; addQuestion: boolean; addStory: boolean };
  openSheet: (name: keyof AppStore['sheet'], value?: unknown) => void;
  closeSheets: () => void;
  account: Account;
}

/** Keys kept in this browser and carried by passphrase sync. */
const SECRETS = ['gemini.key', 'openai.key', 'elevenlabs.key'];

/** Who answers in a role-swap session: Mock, speaking as the user. */
export const REVERSE_CANDIDATE: Interviewer = { n: 1, name: 'Mock as you', role: 'Candidate', mono: 'AI' };

const Ctx = createContext<AppStore | null>(null);
export const useApp = (): AppStore => { const v = useContext(Ctx); if (!v) throw new Error('useApp outside AppProvider'); return v; };

function derive(d: Omit<AppData, 'lpRows' | 'storyRows' | 'questionRows' | 'covered' | 'heat' | 'trend' | 'weakest'>): AppData {
  const rows = lpRows(d.lps, d.stories, d.questions, d.sessions, d.exchanges);
  return { ...d, lpRows: rows, storyRows: storyRows(d.stories, d.lps, d.exchanges), questionRows: questionRows(d.questions, d.lps), covered: coveredLpIds(d.stories), heat: heatmap(d.lps, d.sessions, d.exchanges), trend: trend(d.sessions, d.exchanges), weakest: weakestAnswer(d.sessions, d.exchanges) };
}

const EMPTY: AppData = derive({ lps: [], stories: [], questions: [], files: [], sessions: [], exchanges: [], settings: { interviewDate: '2026-10-30', liveModel: 'gemini-3.8-live', textModel: 'gemini-3.8-flash', voice: 'Aoede', pauseMs: 2500, systemInstruction: '', loopSize: 5, coaching: 'after_each', questionSource: 'mix', storyNotes: true, seed: 12345, lastBackupAt: null, onboarded: false, pricing: DEFAULT_PRICING, usage: [], gamePlays: [], providers: DEFAULT_PROVIDERS } });

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
  const [providerKeys, setProviderKeys] = useState<ProviderKeys>({ openai: '', elevenlabs: '' });
  const [liveState, setLiveState] = useState<SessionState | null>(null);
  const [liveMeta, setLiveMeta] = useState<ControllerMeta | null>(null);
  const controller = useRef<SessionController | null>(null);
  const inMeetRef = useRef(false);
  const [lastStart, setLastStart] = useState<LiveStart | null>(null);
  const [sheet, setSheet] = useState<AppStore['sheet']>({ setup: false, answer: null, addQuestion: false, addStory: false });
  const route = useRoute();
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ phase: 'off', lastSyncedAt: null, error: null, pending: false });
  const [skipped, setSkipped] = useState(() => readFlag('account.skip'));
  const liveRef = useRef<SessionState | null>(null);
  // Library sync with the Mock server: pushes after local writes, pulls on start, focus and every minute.
  const sync = useMemo(() => new SyncEngine(httpSync, { build: () => buildBackup(repo), apply: (doc) => repo.importBackup(doc) }, localMemo, { busy: () => !!liveRef.current && liveRef.current.phase !== 'ended' }), [repo]);
  useEffect(() => sync.subscribe(setSyncStatus), [sync]);
  // Passphrase sync: the library as a CRDT, traded directly between this user's devices.
  const vault = useMemo(() => new Vault({
    local: { build: () => buildBackup(repo), apply: (doc) => repo.importBackup(doc) },
    secrets: {
      read: async (): Promise<Record<string, string>> => {
        const out: Record<string, string> = {};
        for (const name of SECRETS) { const k = await repo.getSecret(name); if (k) out[name] = k; }
        return out;
      },
      write: async (s) => {
        let any = false;
        for (const name of SECRETS) if (s[name]) { await repo.setSecret(name, s[name]); any = true; }
        if (any) await refreshRef.current?.();
      },
    },
    busy: () => !!liveRef.current && liveRef.current.phase !== 'ended',
    persist: idbPersist, saved: localSaved,
  }), [repo]);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>(vault.status);
  useEffect(() => vault.subscribe(setVaultStatus), [vault]);
  useEffect(() => {
    const flush = () => { void vault.flush(); };
    addEventListener('pagehide', flush);
    return () => removeEventListener('pagehide', flush);
  }, [vault]);
  const index = useRef<KnowledgeIndex | null>(null);
  const [kb, setKb] = useState<Omit<KnowledgeState, 'rebuild' | 'search'>>({ status: { files: 0, chunks: 0, embedded: 0 }, indexing: false, error: null });

  const refresh = useCallback(async () => {
    const [lps, stories, questions, files, sessions, exchanges, settings] = await Promise.all([repo.lps(), repo.stories(), repo.questions(), repo.files(), repo.sessions(), repo.exchanges(), repo.settings()]);
    settings.providers = withProviderDefaults(settings.providers);
    setData(derive({ lps, stories, questions, files, sessions, exchanges, settings }));
    const key = (await repo.getSecret('gemini.key')) ?? '';
    const [openai, elevenlabs] = await Promise.all([repo.getSecret('openai.key'), repo.getSecret('elevenlabs.key')]);
    setProviderKeys({ openai: openai ?? '', elevenlabs: elevenlabs ?? '' });
    setGem({ key, hasKey: !!key, model: settings.liveModel, voice: settings.voice });
  }, [repo]);

  const applyServer = useCallback((st: ServerStatus | null) => {
    setServer(st);
    if (st?.user) void sync.start(st.user.id); else sync.stop();
  }, [sync]);
  const reloadAccount = useCallback(async () => { applyServer(await serverStatus()); }, [applyServer]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const probe = serverStatus();
      const mode = await repo.init((s) => alive && setStatus(s));
      if (!alive) return;
      setDbMode(mode);
      index.current = await KnowledgeIndex.load(repo);
      await refresh();
      const st = await probe;
      if (!alive) return;
      setServer(st);
      if (st?.user) { setStatus('Syncing your library…'); await sync.start(st.user.id); }
      if (alive) void vault.start(st ? { signal: st.signal ?? 'off', signedIn: !!st.user } : null);
      if (alive) setReady(true);
    })();
    return () => { alive = false; sync.stop(); void vault.stop(); };
  }, [repo, refresh, sync, vault]);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    const again = () => { if (sync.active && document.visibilityState === 'visible') void sync.sync(); };
    const t = setInterval(again, 60_000);
    document.addEventListener('visibilitychange', again);
    addEventListener('online', again);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', again); removeEventListener('online', again); };
  }, [sync]);

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
    if (patch.key !== undefined) { await repo.setSecret('gemini.key', patch.key || null); vault.changed(); }
    const s: Partial<Settings> = {};
    if (patch.model !== undefined) s.liveModel = patch.model;
    if (patch.voice !== undefined) s.voice = patch.voice;
    if (Object.keys(s).length) await repo.setSettings(s);
    await refresh();
  }, [repo, refresh, vault]);

  const setProviderKey = useCallback(async (name: keyof ProviderKeys, value: string) => {
    await repo.setSecret(name + '.key', value.trim() || null); vault.changed();
    await refresh();
  }, [repo, refresh, vault]);
  const saveProviders = useCallback(async (patch: Partial<ProviderSettings>) => {
    await repo.setSettings({ providers: withProviderDefaults({ ...withProviderDefaults(data.settings.providers), ...patch }) });
    await refresh();
  }, [repo, refresh, data.settings.providers]);
  const providers: ProvidersState = useMemo(() => ({ settings: withProviderDefaults(data.settings.providers), keys: providerKeys, setKey: setProviderKey, save: saveProviders }), [data.settings.providers, providerKeys, setProviderKey, saveProviders]);

  // ---- knowledge index: follows the included prep files; embeds with the Gemini key when there is one
  const embedder = useMemo<Embedder | null>(() => (gemini.key ? geminiEmbedder({ key: gemini.key }) : null), [gemini.key]);
  const syncing = useRef(false);
  const syncIndex = useCallback(async () => {
    const k = index.current;
    if (!k || syncing.current) return;
    if (!k.stale(data.files, !!embedder)) { setKb((x) => ({ ...x, status: k.status() })); return; }
    syncing.current = true;
    setKb((x) => ({ ...x, indexing: true }));
    try { setKb({ status: await k.sync(data.files, embedder), indexing: false, error: null }); }
    catch (e) { setKb({ status: k.status(), indexing: false, error: (e as Error).message || 'Embedding failed' }); }
    finally { syncing.current = false; }
  }, [data.files, embedder]);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => { void syncIndex(); }, 600);
    return () => clearTimeout(t);
  }, [ready, syncIndex]);
  const rebuildIndex = useCallback(async () => {
    index.current = new KnowledgeIndex(repo);
    await syncIndex();
  }, [repo, syncIndex]);
  const searchIndex = useCallback((q: string, k = 3) => index.current ? index.current.search(q, k, embedder) : Promise.resolve([]), [embedder]);
  const knowledge: KnowledgeState = useMemo(() => ({ ...kb, rebuild: rebuildIndex, search: searchIndex }), [kb, rebuildIndex, searchIndex]);

  const exitLive = useCallback(() => {
    controller.current?.destroy();
    controller.current = null;
    setLiveState(null); setLiveMeta(null);
  }, []);

  const startLive = useCallback(async (o: LiveStart) => {
    exitLive();
    setLastStart(o);
    const s = data.settings;
    const prov = withProviderDefaults(s.providers);
    // All Gemini (the default): one Gemini Live connection. Anything else: speech → model → voice,
    // turn by turn. Without what the choice needs (no key at all, by default), the scripted
    // demo. The audio engine is created before the first await so iOS sees the Start tap as its gesture.
    let stack = o.stack ?? stackOf(prov);
    // With Mock in a Google Meet call, the session runs there: meeting audio in, the bot's
    // microphone out (docs/meet.md). Chrome's speech engines cannot reach the call.
    if (meet.inCall() && (stack.stt === 'browser' || stack.tts === 'browser')) {
      toast('Chrome speech cannot hear or speak in a Meet call · this session uses Gemini Live');
      stack = { stt: 'gemini', llm: 'gemini', tts: 'gemini' };
    }
    const live = isLiveStack(stack);
    const missing = missingFor(stack, { gemini: gemini.hasKey, openaiUrl: !!prov.openai.baseUrl.trim(), elevenlabs: !!providerKeys.elevenlabs });
    const demo = !!missing;
    if (missing && !(live && !gemini.hasKey)) toast(stackLabel(stack, prov.openai.model) + ' needs ' + missing + ' · Settings · Voice & model · running the demo');
    const inMeet = !demo && meet.inCall();
    inMeetRef.current = inMeet;
    let media: ReturnType<typeof meet.mediaListener> = null;
    if (inMeet) { try { media = meet.mediaListener(); } catch (err) { toast((err as Error).message + ' · hearing the call through the bot'); } }
    const audio = demo ? null : inMeet ? new MeetAudio(meet.client, new BrowserAudio({ mic: false, speakers: false }), { media, onNotice: toast }) : new BrowserAudio();
    const transport = !audio
      ? new SimulatedTransport(DEMO_SCRIPT)
      : live
        ? new GeminiLiveTransport({ auth: { kind: 'key', key: gemini.key }, audio })
        : makePipeline({ stack, providers: prov, keys: providerKeys, geminiKey: gemini.key, textModel: s.textModel, voice: s.voice, pauseMs: s.pauseMs, audio });
    // The cards and the report come from Flash (or the session's OpenAI-compatible model),
    // falling back to the offline card / local report; the demo replays the script's cards.
    const llm = demo ? null : textLlm(stack, prov, providerKeys);
    const { analyzer, reporter } = analysisPipeline({ key: demo ? null : gemini.key || null, llm, textModel: s.textModel, lps: data.lps, stories: data.stories, script: demo ? DEMO_SCRIPT : null, onFallback: (what, err) => toast((what === 'analysis' ? (llm ? 'Coach card failed' : 'Flash card failed') : (llm ? 'Report failed' : 'Flash report failed')) + ' — used the offline one (' + err.message + ')') });
    // Role swap: the model answers as the user, so there is no answer of theirs to card or report.
    const reverse = o.mode === 'reverse';
    if (reverse && demo) toast('Role swap needs a live model · the demo plays a normal interview');
    const c = new SessionController(transport, reverse ? null : analyzer, repo, () => Date.now(), demo, { reporter });
    controller.current = c;
    c.subscribe((st, meta) => { setLiveState(st); setLiveMeta(meta); if (inMeet) meet.mirror(st); });
    const focusLp = o.mode === 'lp' && o.focus ? data.lps.find((l) => l.id === o.focus) : null;
    const weak = data.lpRows.slice().sort((a, b) => (a.readiness ?? 0.35) - (b.readiness ?? 0.35)).map((l) => l.id);
    const questions = prioritiseQuestions(data.questions, { mode: o.mode, focusLpId: focusLp?.id ?? null, weakLpIds: weak.slice(0, 5) });
    const previous = await repo.reports(8);
    // A small local model gets a system prompt that leaves room for the conversation.
    const budget = !demo && stack.llm === 'openai' ? Math.max(2000, Math.min(SYSTEM_PROMPT_BUDGET, Math.floor(prov.openai.contextTokens * 0.6))) : undefined;
    const ctx = buildContext({ sessionNumber: await repo.nextSessionNumber(), date: new Date().toISOString().slice(0, 10), mode: o.mode, focus: o.focusLabel ?? focusLp?.name ?? o.questionText ?? '', coaching: o.coaching ?? s.coaching, questionSource: s.questionSource, previous, lps: data.lps, stories: data.stories, questions, files: data.files, userInstruction: s.systemInstruction }, { budget });
    c.setContext({ estimated: ctx.estimatedTokens, counted: null, budget: ctx.budget, trimmed: ctx.trimmed });
    if (!demo && live) void confirmTokens(ctx, (t) => countTokens(gemini.key, s.textModel, t)).then((counted) => { if (counted != null) c.setContext({ estimated: ctx.estimatedTokens, counted, budget: ctx.budget, trimmed: ctx.trimmed }); });
    // Show the connecting screen while the mic is granted and the connection opens.
    setSheet({ setup: false, answer: null, addQuestion: false, addStory: false });
    routerGo('/live');
    await c.start({ mode: o.mode, focus: o.focus ?? null, focusLabel: o.focusLabel ?? focusLp?.name ?? '', coaching: o.coaching ?? s.coaching, questionSource: s.questionSource, storyNotes: s.storyNotes, seed: s.seed, systemInstruction: ctx.text, interviewers: reverse ? [REVERSE_CANDIDATE] : INTERVIEWERS, lps: data.lps, stories: data.stories, pauseMs: s.pauseMs, model: live ? s.liveModel : stack.llm === 'openai' ? prov.openai.model : s.textModel, voice: s.voice, questionText: o.questionText ?? null, retriever: index.current ? searchIndex : null, tools: demo ? [] : contextTools(repo) });
  }, [data, gemini.hasKey, gemini.key, providerKeys, repo, exitLive, toast, searchIndex]);

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

  // Mock dropped out of the Meet call mid-session (removed, call ended, bridge stopped): wrap up.
  useEffect(() => meet.subscribe(() => {
    const c = controller.current;
    if (!inMeetRef.current || !c || meet.inCall() || c.state.phase === 'ended') return;
    inMeetRef.current = false;
    toast('Mock left the Meet call' + (meet.state.message ? ' · ' + meet.state.message : '') + ' · session saved');
    void c.end();
  }), [toast]);

  // Refresh the library when a live session writes.
  useEffect(() => {
    repo.onChange = () => { sync.changed(); vault.changed(); void refresh(); };
    return () => { repo.onChange = null; };
  }, [repo, refresh, sync, vault]);
  useEffect(() => { liveRef.current = liveState; }, [liveState]);

  const account: Account = useMemo(() => ({
    server, sync: syncStatus, skipped,
    skip: (on: boolean) => { writeFlag('account.skip', on); setSkipped(on); },
    reload: reloadAccount,
    syncNow: () => sync.sync(),
    vault, vaultStatus,
    hint: server ? { signal: server.signal ?? 'off', signedIn: !!server.user } : null,
  }), [server, syncStatus, skipped, reloadAccount, sync, vault, vaultStatus]);

  const value: AppStore = useMemo(() => ({
    ready, status, dbMode, repo, data, refresh, prefs, setPref, route, go: routerGo, back: routerBack, toast, toastText, gemini, setGemini, providers,
    live: { state: liveState, meta: liveMeta, controller: controller.current, lastStart, start: startLive, exit: exitLive },
    transcript,
    knowledge,
    sheet,
    openSheet: (name, v) => setSheet((x) => ({ ...x, [name]: name === 'answer' ? (v as QuestionRow) : true })),
    closeSheets: () => setSheet({ setup: false, answer: null, addQuestion: false, addStory: false }),
    account,
  }), [account, ready, status, dbMode, repo, data, refresh, prefs, setPref, route, toast, toastText, gemini, setGemini, providers, liveState, liveMeta, lastStart, startLive, exitLive, sheet, transcript, knowledge]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
