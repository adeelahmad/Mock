// Mock — the PWA shortcut deep links (plan D6): `#/start` starts today's suggested drill,
// `#/last` opens the latest session in History. An iOS Shortcut bound to the Action button can
// open either URL. Both wait for the data, and send a first run to onboarding instead.

import { useEffect, useRef } from 'react';
import { useApp } from './store.tsx';
import { paths } from './router.ts';
import { todayQueue } from '../screens/Home.tsx';

export const DEEP_LINKS = { start: '/start', last: '/last' } as const;

export function useDeepLinks(): void {
  const app = useApp();
  const { ready, route, data, go, live } = app;
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || (route.path !== DEEP_LINKS.start && route.path !== DEEP_LINKS.last)) { handled.current = null; return; }
    if (handled.current === route.path) return; // StrictMode runs effects twice
    handled.current = route.path;
    if (!data.settings.onboarded) { go(paths.practice, true); return; }
    if (route.path === DEEP_LINKS.last) {
      const last = data.sessions.slice().sort((a, b) => b.number - a.number)[0];
      go(last ? paths.session(last.id) : paths.history, true);
      return;
    }
    go(paths.practice, true);
    const focus = todayQueue(data)[0]?.lp ?? data.lpRows[0];
    if (focus) void live.start({ mode: 'lp', focus: focus.id, focusLabel: focus.name });
  }, [ready, route.path, data, go, live]);
}
