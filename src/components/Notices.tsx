// Mock — the small notices above Start on Practice home (plan M5): offline (Live needs a
// connection), the backup nudge (last session not in a backup yet), and the install hint
// (Chromium's prompt, or "Share → Add to Home Screen" on iOS, where it also keeps the data from
// being evicted). One at a time, most urgent first; each but offline can be dismissed.

import React, { useState } from 'react';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { readFlag, writeFlag } from '../app/prefs.ts';
import { needsBackup, useInstall } from '../app/install.ts';
import { Icon } from './ui.tsx';

function Notice({ tone, title, sub, action, onAction, onDismiss }: { tone: 'gold' | 'plain'; title: string; sub: React.ReactNode; action?: string; onAction?: () => void; onDismiss?: () => void }) {
  return (
    <div className={'notice ' + tone} role="status">
      <div className="stack g2 grow"><span className="notice-title">{title}</span><span className="notice-sub pretty">{sub}</span></div>
      {action && <button className="btn sm" onClick={onAction}>{action}</button>}
      {onDismiss && <button className="icon-btn notice-x" aria-label="Dismiss" onClick={onDismiss}><Icon.Close size={16} /></button>}
    </div>
  );
}

const ShareGlyph = () => (
  <svg viewBox="0 0 24 24" className="ic" style={{ width: 14, height: 14, verticalAlign: '-2px' }} aria-label="Share"><path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
);

export default function Notices({ online }: { online: boolean }) {
  const { data, gemini, go } = useApp();
  const { kind, install } = useInstall();
  const latest = data.sessions.reduce<string | null>((m, s) => (s.endedAt && (!m || s.endedAt > m) ? s.endedAt : m), null);
  const backupKey = 'backup.snooze.' + (latest ?? '');
  const [, tick] = useState(0);
  const dismiss = (key: string) => { writeFlag(key, true); tick((n) => n + 1); };

  if (!online) {
    return <Notice tone="gold" title="Offline" sub={gemini.hasKey ? 'Live sessions need a connection. Library, History and Progress still work.' : 'The demo runs offline. Live sessions need a connection.'} />;
  }
  if (needsBackup(data.settings.lastBackupAt, data.sessions) && !readFlag(backupKey)) {
    return <Notice tone="gold" title="Back up your last session" sub={data.settings.lastBackupAt ? 'It isn’t in a backup yet. Everything lives in this browser only.' : 'You haven’t backed up yet. Everything lives in this browser only.'} action="Back up" onAction={() => go(paths.settings)} onDismiss={() => dismiss(backupKey)} />;
  }
  if (kind === 'prompt' && !readFlag('install.dismissed')) {
    return <Notice tone="plain" title="Install Mock" sub="Opens like an app, works offline, and adds Start and Last session shortcuts." action="Install" onAction={() => { void install(); }} onDismiss={() => dismiss('install.dismissed')} />;
  }
  if (kind === 'ios' && !readFlag('install.dismissed')) {
    return <Notice tone="plain" title="Add Mock to your Home Screen" sub={<>Tap <ShareGlyph /> Share, then “Add to Home Screen”. Safari can clear data of sites not on the Home Screen.</>} onDismiss={() => dismiss('install.dismissed')} />;
  }
  return null;
}
