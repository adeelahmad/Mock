// Mock — the "Test · say hello" hook shared by Settings and first run. M3 opens a real Live
// session; until then it reports the demo transport.

import { useCallback, useEffect, useRef, useState } from 'react';

export type HelloState = 'idle' | 'nokey' | 'connecting' | 'ok';
export function useHelloTest(): { state: HelloState; text: string; run: (key: string) => void } {
  const [state, setState] = useState<HelloState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const run = useCallback((key: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!key.trim()) { setState('nokey'); return; }
    setState('connecting');
    // M3: open a Live session, send "say hello", measure the mic level and the pause from the first turn.
    timer.current = setTimeout(() => { setState('ok'); timer.current = null; }, 1500);
  }, []);
  const text = state === 'nokey' ? 'Paste an API key first.' : state === 'connecting' ? 'Connecting…' : state === 'ok' ? '✓ Connected — demo transport' : '';
  return { state, text, run };
}

