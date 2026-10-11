// Mock — the shell. Phone: one screen at a time with the tab bar. Desktop (≥ 900 px): the
// sidebar plus master-detail where the design shows it. The live session sits on top of
// everything; the splash covers the app until the database is ready.

import React from 'react';
import { useApp } from './store.tsx';
import { paths } from './router.ts';
import { useDeepLinks } from './deeplinks.ts';
import { Icon } from '../components/ui.tsx';
import { daysUntil } from '../domain/selectors.ts';
import Home from '../screens/Home.tsx';
import Library from '../screens/Library.tsx';
import LpDetail from '../screens/LpDetail.tsx';
import StoryEditor from '../screens/StoryEditor.tsx';
import Grid from '../screens/Grid.tsx';
import FilePreview from '../screens/FilePreview.tsx';
import History, { SessionDetail } from '../screens/History.tsx';
import Progress from '../screens/Progress.tsx';
import Settings from '../screens/Settings.tsx';
import { usePwa } from './pwa.ts';
import Onboarding from '../screens/Onboarding.tsx';
import Live from '../screens/Live.tsx';
import { ServerSetup, SignIn } from '../screens/Account.tsx';
import { SetupSheet, AnswerSheet, AddQuestionSheet, AddStorySheet } from '../screens/Sheets.tsx';

function Sidebar() {
  const { route, go, data } = useApp();
  const lib = route.parts[1] ?? 'lps';
  const item = (tab: string, label: string, icon: React.ReactNode, path: string) => (
    <button className={'nav-item' + (route.tab === tab ? ' on' : '')} onClick={() => go(path)}>{icon}{label}</button>
  );
  return (
    <nav className="sidebar" aria-label="Sections">
      <span className="wordmark">Mock</span>
      {item('practice', 'Practice', <Icon.Mic />, paths.practice)}
      {item('library', 'Library', <Icon.Library />, paths.library('lps'))}
      {route.tab === 'library' && (
        <div className="nav-sub">
          {(['lps', 'stories', 'questions', 'files'] as const).map((s) => <button key={s} className={lib === s ? 'on' : ''} onClick={() => go(paths.library(s))}>{{ lps: 'LPs', stories: 'Stories', questions: 'Questions', files: 'Files' }[s]}</button>)}
        </div>
      )}
      {item('history', 'History', <Icon.Clock />, paths.history)}
      {item('progress', 'Progress', <Icon.Trend />, paths.progress)}
      <span style={{ flex: 1 }} />
      <div className="nav-days"><span className="sub" style={{ font: '500 12px/1.2 var(--font-sans)' }}>Interview</span><span className="mono" style={{ font: '500 14px/1 var(--font-mono)', color: 'var(--m-warm)' }}>{daysUntil(data.settings.interviewDate)} days</span></div>
      <button className={'nav-item' + (route.path === paths.settings ? ' on' : '')} onClick={() => go(paths.settings)}><Icon.Settings />Settings</button>
    </nav>
  );
}

function TabBar() {
  const { route, go } = useApp();
  const tabs: [string, string, React.ReactNode, string][] = [
    ['practice', 'Practice', <Icon.Mic key="p" />, paths.practice], ['library', 'Library', <Icon.Library key="l" />, paths.library('lps')],
    ['history', 'History', <Icon.Clock key="h" />, paths.history], ['progress', 'Progress', <Icon.Trend key="g" />, paths.progress],
  ];
  return (
    <nav className="tabbar" aria-label="Tabs">
      {tabs.map(([tab, label, icon, path]) => <button key={tab} className={route.tab === tab ? 'on' : ''} onClick={() => go(path)} aria-current={route.tab === tab ? 'page' : undefined}>{icon}<span>{label}</span></button>)}
    </nav>
  );
}

/** On a Mock server: the setup wizard until sign-in is set up, then sign-in, unless the user chose local-only. */
export function accountGate(account: ReturnType<typeof useApp>['account']): 'setup' | 'signin' | null {
  const s = account.server;
  if (!s || account.skipped || s.user) return null;
  return s.configured ? 'signin' : 'setup';
}

function Screen() {
  const { route, data, account } = useApp();
  const [a, b, c] = route.parts;
  if (a === 'practice' && b === 'server-setup') return <ServerSetup />;
  if (a === 'practice' && b === 'sign-in') return <SignIn />;
  const gate = accountGate(account);
  if (gate === 'setup') return <ServerSetup />;
  if (gate === 'signin') return <SignIn />;
  if (a === 'practice' && b === 'settings') return <Settings />;
  if (a === 'practice' && b === 'setup') return <Onboarding />;
  if (a === 'library') {
    if (b === 'lps' && c) return <LpDetail id={c} />;
    if (b === 'stories' && c === 'grid') return <Grid />;
    if (b === 'stories' && c) return <StoryEditor id={c} />;
    if (b === 'files' && c) return <FilePreview id={c} />;
    return <Library seg={(b as 'lps' | 'stories' | 'questions' | 'files') ?? 'lps'} />;
  }
  if (a === 'history') return b ? <SessionDetail id={b} /> : <History />;
  if (a === 'progress') return <Progress />;
  if (!data.settings.onboarded) return <Onboarding />;
  return <Home />;
}

export default function App() {
  const { ready, status, toastText, live, route, sheet, closeSheets, data, account } = useApp();
  useDeepLinks();
  const pwa = usePwa();
  const inLive = route.path === paths.live && live.state;
  const firstRun = !data.settings.onboarded || route.path === paths.onboarding || route.path === paths.serverSetup || route.path === paths.signIn || !!accountGate(account);
  const showTabs = !inLive && ['practice', 'library', 'history', 'progress'].includes(route.tab) && route.parts.length <= 2 && route.path !== paths.settings && route.path !== paths.onboarding && !firstRun;
  return (
    <div className="app">
      {!inLive && !firstRun && <Sidebar />}
      <div className="shell">
        {inLive ? <Live /> : <Screen />}
        {showTabs && <TabBar />}
      </div>
      <SetupSheet open={sheet.setup} onClose={closeSheets} />
      <AnswerSheet question={sheet.answer} onClose={closeSheets} />
      <AddQuestionSheet open={sheet.addQuestion} onClose={closeSheets} />
      <AddStorySheet open={sheet.addStory} onClose={closeSheets} />
      {toastText && <div className="toast" role="status">{toastText}</div>}
      {pwa.needRefresh && !inLive && (
        <div className="toast update" role="status">
          <span>Update available</span>
          <span className="hstack" style={{ gap: 6 }}><button className="toast-btn" onClick={pwa.reload}>Reload</button><button className="toast-btn ghost" onClick={pwa.dismiss}>Later</button></span>
        </div>
      )}
      {!ready && (
        <div className="splash">
          <span className="wordmark big">Mock</span>
          <span className="spinner" style={{ width: 18, height: 18 }} />
          <span className="sub">{status}</span>
        </div>
      )}
    </div>
  );
}
