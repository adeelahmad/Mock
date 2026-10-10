// Light first; dark reuses Aladdin's terminal palette; "system" follows the OS.
import type { UiPrefs } from '../domain/types.ts';

let mq: MediaQueryList | null = null;
let current: UiPrefs['theme'] = 'light';

function resolve(theme: UiPrefs['theme']): 'light' | 'dark' {
  if (theme === 'system') return mq?.matches ? 'dark' : 'light';
  return theme;
}

export function applyTheme(theme: UiPrefs['theme']): void {
  current = theme;
  if (!mq && typeof window !== 'undefined' && window.matchMedia) {
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => applyTheme(current));
  }
  const mode = resolve(theme);
  document.documentElement.setAttribute('data-theme', mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mode === 'dark' ? '#18191B' : '#FFFFFF');
}
