// A hash router: works on any static host without rewrite rules, and the routes double as
// deep links for PWA shortcuts (#/start, #/last).
import { useEffect, useState } from 'react';

export type Tab = 'practice' | 'library' | 'history' | 'progress';

export interface Route {
  path: string;
  parts: string[];
  tab: Tab;
  query: URLSearchParams;
}

export function parseRoute(hash: string): Route {
  const raw = (hash || '#/practice').replace(/^#/, '');
  const [p, q = ''] = raw.split('?');
  const parts = p.split('/').filter(Boolean).map(decodeURIComponent);
  const first = parts[0] ?? 'practice';
  const tab: Tab = first === 'library' ? 'library' : first === 'history' ? 'history' : first === 'progress' ? 'progress' : 'practice';
  return { path: '/' + parts.join('/'), parts, tab, query: new URLSearchParams(q) };
}

const listeners = new Set<() => void>();
export const current = (): Route => parseRoute(typeof location !== 'undefined' ? location.hash : '');
export function go(path: string, replace = false): void {
  const target = '#' + (path.startsWith('/') ? path : '/' + path);
  if (replace) history.replaceState(null, '', target); else location.hash = target;
  if (replace) listeners.forEach((l) => l());
}
export function back(fallback: string): void {
  if (history.length > 1 && document.referrer !== '') history.back(); else go(fallback, true);
}

if (typeof window !== 'undefined') window.addEventListener('hashchange', () => listeners.forEach((l) => l()));

export function useRoute(): Route {
  const [r, set] = useState<Route>(current);
  useEffect(() => { const l = () => set(current()); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return r;
}

export const paths = {
  practice: '/practice', settings: '/practice/settings', onboarding: '/practice/setup',
  library: (seg: 'lps' | 'stories' | 'questions' | 'files' = 'lps') => '/library/' + seg,
  lp: (id: string) => '/library/lps/' + id,
  story: (id: string) => '/library/stories/' + id,
  grid: '/library/stories/grid',
  file: (id: string) => '/library/files/' + id,
  history: '/history', session: (id: string) => '/history/' + id,
  /** A session detail opened on one answer (0-based position in the session). */
  answer: (sessionId: string, index: number) => '/history/' + sessionId + '?q=' + index,
  importFile: (fileId: string) => '/library/questions?import=' + fileId,
  progress: '/progress',
  live: '/live',
};
