// Mock — install, connectivity and backup nudges (plan M5). Chromium hands us a
// `beforeinstallprompt` event to replay from our own button; iOS Safari has no prompt, so it gets
// the "Share → Add to Home Screen" hint instead. Storage on iOS is evicted unless the app is on
// the Home Screen, which is why the hint matters there.

import { useEffect, useState } from 'react';
import type { Session } from '../domain/types.ts';

interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

export type InstallKind = 'installed' | 'prompt' | 'ios' | null;

/** Which install affordance to show: none when already installed or nothing is offered. */
export function installKind(o: { standalone: boolean; hasPrompt: boolean; ua: string; maxTouchPoints?: number }): InstallKind {
  if (o.standalone) return 'installed';
  if (o.hasPrompt) return 'prompt';
  // iPadOS reports a desktop Mac user agent; touch points tell them apart.
  const ios = /iPhone|iPad|iPod/.test(o.ua) || (/Macintosh/.test(o.ua) && (o.maxTouchPoints ?? 0) > 1);
  // Any iOS browser (16.4+) can add to the Home Screen; in-app WebViews lack "Safari/" and cannot.
  return ios && /Safari\//.test(o.ua) ? 'ios' : null;
}

/** True when a finished session is newer than the last full backup. */
export function needsBackup(lastBackupAt: string | null, sessions: Pick<Session, 'startedAt' | 'endedAt'>[]): boolean {
  const lastSession = sessions.reduce<string | null>((m, s) => { const t = s.endedAt ?? null; return t && (!m || t > m) ? t : m; }, null);
  if (!lastSession) return false;
  return !lastBackupAt || Date.parse(lastBackupAt) < Date.parse(lastSession);
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPromptEvent; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; installed = true; emit(); });
}

const isStandalone = (): boolean => {
  if (typeof window === 'undefined') return false;
  return installed || window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
};

export interface InstallState { kind: InstallKind; install: () => Promise<void> }

export function useInstall(): InstallState {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const kind = typeof navigator === 'undefined' ? null : installKind({ standalone: isStandalone(), hasPrompt: !!deferred, ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
  const install = async () => {
    const e = deferred; if (!e) return;
    deferred = null; emit();
    await e.prompt();
    try { if ((await e.userChoice).outcome === 'accepted') { installed = true; emit(); } } catch { /* no choice reported */ }
  };
  return { kind, install };
}

export function useOnline(): boolean {
  const [online, set] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => set(true), down = () => set(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}
