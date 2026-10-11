// Mock — interviewer personas and live models (plan D5, D8).
// The design names five interviewers; Gemini voices have their own names, so each persona
// maps to one. Settings shows the persona list; the live config carries the Gemini voice.

export interface VoicePersona { mono: string; name: string; full: string; desc: string; short: string; voice: string }

export const VOICES: VoicePersona[] = [
  { mono: 'DW', name: 'Dana', full: 'Dana Whitfield', desc: 'Even, unhurried · British', short: 'even, unhurried', voice: 'Aoede' },
  { mono: 'PR', name: 'Priya', full: 'Priya Raman', desc: 'Warm, quick follow-ups', short: 'warm, quick', voice: 'Kore' },
  { mono: 'TN', name: 'Tomasz', full: 'Tomasz Nowak', desc: 'Dry, precise', short: 'dry, precise', voice: 'Puck' },
  { mono: 'MO', name: 'Marcus', full: 'Marcus Oyelaran', desc: 'Low, deliberate', short: 'low, deliberate', voice: 'Charon' },
  { mono: 'EC', name: 'Elena', full: 'Elena Castellanos', desc: 'Brisk, curious', short: 'brisk, curious', voice: 'Leda' },
];

export const personaFor = (voice: string): VoicePersona | null => VOICES.find((v) => v.voice === voice) ?? null;

/** The preview plays a live greeting; without a key it can only say so. */
export const previewToast = (p: VoicePersona): string => 'Add a Gemini key to hear ' + p.name;

/** Live model ids verified against the Gemini docs on 2026-10-10 (docs/plan.md §2). */
export const MODELS: { value: string; label: string }[] = [
  { value: 'gemini-3.8-live', label: 'Live · balanced' },
  { value: 'gemini-3.8-live-extended-thinking', label: 'Live · most thorough' },
];
export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';
export const DEFAULT_TEXT_MODEL = 'gemini-3.8-flash';
