// Small UI preferences in localStorage, every access wrapped in try/catch.
import type { UiPrefs } from '../domain/types.ts';

const KEY = 'mock.prefs.v1';
export const DEFAULT_PREFS: UiPrefs = { theme: 'light', voiceVisual: 'orb', liveLayout: 'stage', lastTab: 'practice' };

export function readPrefs(): UiPrefs {
  try { const raw = localStorage.getItem(KEY); return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS }; } catch { return { ...DEFAULT_PREFS }; }
}
export function writePrefs(p: UiPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}
export function readFlag(key: string): boolean {
  try { return localStorage.getItem('mock.' + key) === '1'; } catch { return false; }
}
export function writeFlag(key: string, on: boolean): void {
  try { if (on) localStorage.setItem('mock.' + key, '1'); else localStorage.removeItem('mock.' + key); } catch { /* ignore */ }
}
