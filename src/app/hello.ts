// Mock — "Test · say hello" and the voice preview, shared by Settings and first run: one
// real live turn each (src/live/hello.ts).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './store.tsx';
import { personaFor, previewToast, type VoicePersona } from '../domain/voices.ts';
import { helloTest, previewVoice, type HelloResult } from '../live/hello.ts';

const fmtPause = (ms: number): string => (ms / 1000).toFixed(2).replace(/\.?0+$/, '') + ' s';

export type HelloState = 'idle' | 'nokey' | 'connecting' | 'ok' | 'failed';
export function useHelloTest(): { state: HelloState; text: string; result: HelloResult | null; run: (key: string) => void } {
  const { gemini } = useApp();
  const [state, setState] = useState<HelloState>('idle');
  const [result, setResult] = useState<HelloResult | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = useCallback((key: string) => {
    if (!key.trim()) { setState('nokey'); return; }
    setState('connecting'); setResult(null);
    const p = personaFor(gemini.voice);
    helloTest(key.trim(), gemini.model, gemini.voice, p?.full ?? 'the interviewer')
      .then((r) => { if (!alive.current) return; setResult(r); setState(r.heard ? 'ok' : 'failed'); setError(r.heard ? '' : 'Connected, but no audio came back.'); })
      .catch((err: Error) => { if (!alive.current) return; setState('failed'); setError(err.message || 'Could not connect'); });
  }, [gemini.model, gemini.voice]);
  const pause = result?.suggestedPauseMs ? ' · suggested pause ' + fmtPause(result.suggestedPauseMs) : '';
  const text = state === 'nokey' ? 'Paste an API key first.' : state === 'connecting' ? 'Connecting…' : state === 'ok' ? '✓ Connected' + pause : state === 'failed' ? error : '';
  return { state, text, result, run };
}

/** Plays one persona's live greeting; a toast when there is no key or the call fails. */
export function useVoicePreview(): (p: VoicePersona) => void {
  const { gemini, toast } = useApp();
  const busy = useRef(false);
  return useCallback((p: VoicePersona) => {
    if (!gemini.hasKey) { toast(previewToast(p)); return; }
    if (busy.current) return;
    busy.current = true;
    previewVoice(gemini.key, gemini.model, p.voice, p.full, p.short)
      .then((r) => { if (!r.heard) toast('No audio came back for ' + p.name); })
      .catch((err: Error) => toast('Preview failed: ' + (err.message || 'could not connect')))
      .finally(() => { busy.current = false; });
  }, [gemini.hasKey, gemini.key, gemini.model, toast]);
}
