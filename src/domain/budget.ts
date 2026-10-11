// Mock — what Gemini has cost so far. Every call's token counts land in a ledger of buckets
// (model × Leadership Principle) kept in settings; the dollar figure is computed from those
// counts and the editable price table, so changing a price re-prices the history.
// Default prices: https://ai.google.dev/gemini-api/docs/pricing, Standard paid tier, checked
// 2026-10-11 (Flash input/output double on 2027-01-01 — edit them in Settings then).

import type { Lp, ModelPrice, TokenUsage, UsageBucket } from './types.ts';

export const DEFAULT_PRICING: ModelPrice[] = [
  { model: 'gemini-3.8-live', input: 0.75, output: 4.5, audioInput: 3, audioOutput: 12 },
  { model: 'gemini-3.8-live-extended-thinking', input: 0.75, output: 4.5, audioInput: 3, audioOutput: 12 },
  { model: 'gemini-3.8-flash', input: 0.75, output: 3.75, audioInput: 0.75, audioOutput: 3.75 },
  { model: 'gemini-embedding-001', input: 0.15, output: 0, audioInput: 0, audioOutput: 0 },
  { model: 'gemini-2.5-flash-preview-tts', input: 0.5, output: 10, audioInput: 0, audioOutput: 10 },
];

/**
 * The price row for a model: exact id, else the longest listed id it starts with, else (for a
 * Gemini model) the first row. Other models (a local or OpenAI-compatible one) without a row
 * of their own are free: Ollama costs nothing; add a row to price a paid endpoint.
 */
export function priceFor(model: string, pricing: ModelPrice[]): ModelPrice | null {
  const id = model.replace(/^models\//, '');
  const exact = pricing.find((p) => p.model === id);
  if (exact) return exact;
  const prefix = pricing.filter((p) => p.model && id.startsWith(p.model)).sort((a, b) => b.model.length - a.model.length)[0];
  // A model added to the defaults after the table was saved (the embedding model) prices at its default, not the first row.
  return prefix ?? DEFAULT_PRICING.find((p) => p.model === id) ?? (id.startsWith('gemini') ? pricing[0] ?? null : null);
}

/** USD for some token counts at one model's prices (prices are per 1M tokens). */
export function costOf(u: TokenUsage, p: ModelPrice | null): number {
  if (!p) return 0;
  return (u.input * p.input + u.output * p.output + u.audioInput * p.audioInput + u.audioOutput * p.audioOutput) / 1e6;
}

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, audioInput: 0, audioOutput: 0 };

interface ModalityCount { modality?: string; tokenCount?: number }
const audioOf = (d: unknown): number => (Array.isArray(d) ? (d as ModalityCount[]).filter((x) => String(x.modality).toUpperCase() === 'AUDIO').reduce((s, x) => s + (Number(x.tokenCount) || 0), 0) : 0);

/**
 * A `usageMetadata` object (REST generateContent or a Live server message) → billable tokens.
 * Thinking tokens bill as output; tool-use prompt tokens as input. Audio is split out by modality.
 */
export function parseUsageMetadata(meta: unknown): TokenUsage | null {
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Record<string, unknown>;
  const n = (k: string) => Number(m[k]) || 0;
  const prompt = n('promptTokenCount') + n('toolUsePromptTokenCount');
  const response = n('candidatesTokenCount') + n('responseTokenCount') + n('thoughtsTokenCount');
  const audioInput = Math.min(prompt, audioOf(m.promptTokensDetails) + audioOf(m.toolUsePromptTokensDetails));
  const audioOutput = Math.min(response, audioOf(m.candidatesTokensDetails) + audioOf(m.responseTokensDetails));
  const u = { input: prompt - audioInput, output: response - audioOutput, audioInput, audioOutput };
  return u.input || u.output || u.audioInput || u.audioOutput ? u : null;
}

/** Adds one call's tokens to the ledger (returns a new array). */
export function addToLedger(ledger: UsageBucket[], model: string, lpId: string | null, u: TokenUsage): UsageBucket[] {
  const id = model.replace(/^models\//, '');
  const i = ledger.findIndex((b) => b.model === id && b.lpId === lpId);
  const prev = i >= 0 ? ledger[i] : { model: id, lpId, calls: 0, ...ZERO_USAGE };
  const next: UsageBucket = { ...prev, calls: prev.calls + 1, input: prev.input + u.input, output: prev.output + u.output, audioInput: prev.audioInput + u.audioInput, audioOutput: prev.audioOutput + u.audioOutput };
  return i >= 0 ? ledger.map((b, j) => (j === i ? next : b)) : [...ledger, next];
}

export interface SpendRow { lpId: string | null; label: string; usd: number; tokens: number }
export interface Spend { total: number; tokens: number; rows: SpendRow[] }

/** Total spend and the per-LP breakdown, most expensive first; calls with no LP are "Reports & other". */
export function spend(ledger: UsageBucket[], pricing: ModelPrice[], lps: Lp[]): Spend {
  const byLp = new Map<string | null, SpendRow>();
  let total = 0, tokens = 0;
  for (const b of ledger) {
    const usd = costOf(b, priceFor(b.model, pricing));
    const t = b.input + b.output + b.audioInput + b.audioOutput;
    total += usd; tokens += t;
    const key = b.lpId && lps.some((l) => l.id === b.lpId) ? b.lpId : null;
    const row = byLp.get(key) ?? { lpId: key, label: key ? lps.find((l) => l.id === key)!.name : 'Reports & other', usd: 0, tokens: 0 };
    row.usd += usd; row.tokens += t;
    byLp.set(key, row);
  }
  return { total, tokens, rows: [...byLp.values()].sort((a, b) => b.usd - a.usd) };
}

/** "$0.00", "$0.004", "$1.23", "$1,234". Sub-cent amounts keep one significant digit. */
export function fmtUsd(v: number): string {
  if (v > 0 && v < 0.01) return '$' + v.toPrecision(1);
  if (v >= 1000) return '$' + Math.round(v).toLocaleString('en-US');
  return '$' + v.toFixed(2);
}

export const fmtTokens = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
