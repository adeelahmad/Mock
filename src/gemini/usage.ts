// Mock — the usage meter. Every Gemini call reports its `usageMetadata` here with the model and
// the Leadership Principle it was spent on; the app store installs the sink that adds it to the
// ledger in settings (see domain/budget.ts). With no sink (tests, Node) reports are dropped.

import { parseUsageMetadata } from '../domain/budget.ts';
import type { TokenUsage } from '../domain/types.ts';

export type UsageSink = (model: string, lpId: string | null, usage: TokenUsage) => void;

let sink: UsageSink | null = null;

/** Installs the sink; returns a function that removes it. */
export function setUsageSink(s: UsageSink | null): () => void {
  sink = s;
  return () => { if (sink === s) sink = null; };
}

export function reportUsage(model: string, lpId: string | null, usageMetadata: unknown): void {
  const u = parseUsageMetadata(usageMetadata);
  if (u && sink) { try { sink(model, lpId, u); } catch { /* never break a call over accounting */ } }
}
