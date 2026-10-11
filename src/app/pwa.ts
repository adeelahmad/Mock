// Mock — service worker registration with an explicit update prompt. The app shows
// "Update available · Reload" when a new build is waiting; nothing reloads on its own, so a
// live session is never interrupted. Dev and `?repo=` runs (tests, screenshots) skip it.

import { useEffect, useState } from 'react';

export interface PwaState { needRefresh: boolean; offlineReady: boolean; reload: () => void; dismiss: () => void }

let update: ((reload?: boolean) => Promise<void>) | null = null;
const listeners = new Set<(s: { needRefresh: boolean; offlineReady: boolean }) => void>();
let state = { needRefresh: false, offlineReady: false };
const set = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); };

export async function registerPwa(): Promise<void> {
  if (import.meta.env.DEV || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (new URLSearchParams(location.search).has('repo')) return;
  const { registerSW } = await import('virtual:pwa-register');
  update = registerSW({
    immediate: true,
    onNeedRefresh: () => set({ needRefresh: true }),
    onOfflineReady: () => set({ offlineReady: true }),
  });
}

export function usePwa(): PwaState {
  const [s, setS] = useState(state);
  useEffect(() => { listeners.add(setS); return () => { listeners.delete(setS); }; }, []);
  return { ...s, reload: () => { void update?.(true); }, dismiss: () => set({ needRefresh: false, offlineReady: false }) };
}
