// Mock — "Test · say hello" and the voice preview: one short live turn on the real
// transport. The hello test opens the mic (granting it once), lets the interviewer greet,
// and measures the candidate's level and how long they pause between phrases, so Settings
// can suggest a pause length (plan §8.4: suggest, never auto-apply). The preview plays a
// persona's greeting without the mic.

import { GeminiLiveTransport } from './gemini.ts';
import { BrowserAudio } from './audio.ts';

export interface HelloResult {
  /** The model answered with audio. */
  heard: boolean;
  /** Loudest mic level seen, 0..1 (null without the mic). */
  peakLevel: number | null;
  /** Suggested end-of-turn pause in ms from the gaps measured in the candidate's speech, or null. */
  suggestedPauseMs: number | null;
}

const ON = 0.05, OFF = 0.025;

/** From mic-level samples [tMs, level], the longest gap inside speech (not after the last word), padded and clamped to the slider. */
export function suggestPause(samples: [number, number][]): number | null {
  let speaking = false, lastOff = -1, longest = 0, spoke = false;
  for (const [t, v] of samples) {
    if (!speaking && v > ON) { if (lastOff >= 0 && spoke) longest = Math.max(longest, t - lastOff); speaking = true; spoke = true; }
    else if (speaking && v < OFF) { speaking = false; lastOff = t; }
  }
  if (!longest) return null;
  return Math.min(4000, Math.max(1000, Math.round((longest + 700) / 100) * 100));
}

export async function liveTurn(o: { key: string; model: string; voice: string; instruction: string; prompt: string; mic: boolean; listenMs?: number }): Promise<HelloResult> {
  const audio = new BrowserAudio({ mic: o.mic, record: false });
  const t = new GeminiLiveTransport({ auth: { kind: 'key', key: o.key }, audio, transcribeInput: false, retryDelaysMs: [] });
  const samples: [number, number][] = [];
  let heard = false, peak = 0;
  const t0 = Date.now();
  try {
    await new Promise<void>((resolve, reject) => {
      let spoke = false;
      const done = setTimeout(resolve, o.listenMs ?? 12000);
      t.on((e) => {
        if (e.type === 'aiSpeaking') { if (e.speaking) { heard = true; spoke = true; } else if (spoke && !o.mic) { clearTimeout(done); setTimeout(resolve, 200); } }
        if (e.type === 'level') { samples.push([Date.now() - t0, e.value]); peak = Math.max(peak, e.value); }
        if (e.type === 'error') { clearTimeout(done); reject(new Error(e.message)); }
      });
      t.connect({ model: o.model, voice: o.voice, systemInstruction: o.instruction, tools: [], silenceDurationMs: 1200 })
        .then(() => t.sendText(o.prompt))
        .catch((err) => { clearTimeout(done); reject(err); });
    });
  } finally {
    t.close();
  }
  return { heard, peakLevel: o.mic ? peak : null, suggestedPauseMs: o.mic ? suggestPause(samples) : null };
}

export const helloTest = (key: string, model: string, voice: string, name: string) => liveTurn({
  key, model, voice, mic: true, listenMs: 10000,
  instruction: `You are ${name}, a friendly interviewer checking the candidate's audio before a practice interview. Keep every reply to one short sentence.`,
  prompt: 'Say hello, ask me to say a sentence or two about my day so you can check my microphone, then listen.',
});

export const previewVoice = (key: string, model: string, voice: string, name: string, desc: string) => liveTurn({
  key, model, voice, mic: false, listenMs: 8000,
  instruction: `You are ${name}, an interviewer. Voice: ${desc}. Reply in one short sentence.`,
  prompt: `Introduce yourself as ${name} in one sentence.`,
});
