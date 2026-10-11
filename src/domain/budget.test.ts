import { describe, expect, it } from 'vitest';
import { addToLedger, costOf, DEFAULT_PRICING, fmtUsd, parseUsageMetadata, priceFor, spend } from './budget.ts';
import { MemoryRepo } from '../db/memory.ts';
import { parseServerMessage } from '../live/gemini-protocol.ts';

const lps = [{ id: 'ownership', name: 'Ownership', short: 'OWN', description: '', order: 1, isDefault: true }, { id: 'bias', name: 'Bias for Action', short: 'BIAS', description: '', order: 2, isDefault: true }];

describe('budget', () => {
  it('splits REST and Live usage metadata into text and audio tokens', () => {
    expect(parseUsageMetadata({ promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 50, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 400 }, { modality: 'AUDIO', tokenCount: 600 }] }))
      .toEqual({ input: 400, output: 250, audioInput: 600, audioOutput: 0 });
    expect(parseUsageMetadata({ promptTokenCount: 5000, responseTokenCount: 900, responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 900 }] }))
      .toEqual({ input: 5000, output: 0, audioInput: 0, audioOutput: 900 });
    expect(parseUsageMetadata({ totalTokenCount: 0 })).toBeNull();
    expect(parseUsageMetadata(null)).toBeNull();
  });

  it('prices per 1M tokens, matching model ids exactly, then by prefix, then the first row', () => {
    const live = priceFor('models/gemini-3.8-live', DEFAULT_PRICING)!;
    expect(live.model).toBe('gemini-3.8-live');
    expect(priceFor('gemini-3.8-flash-001', DEFAULT_PRICING)!.model).toBe('gemini-3.8-flash');
    expect(priceFor('gemini-something-else', DEFAULT_PRICING)!.model).toBe(DEFAULT_PRICING[0].model);
    // A local or OpenAI-compatible model without a row is free.
    expect(priceFor('llama3.2', DEFAULT_PRICING)).toBeNull();
    expect(costOf({ input: 1e6, output: 1e6, audioInput: 0, audioOutput: 0 }, priceFor('llama3.2', DEFAULT_PRICING))).toBe(0);
    expect(costOf({ input: 1e6, output: 1e6, audioInput: 1e6, audioOutput: 1e6 }, live)).toBeCloseTo(0.75 + 4.5 + 3 + 12);
  });

  it('totals the ledger and breaks it down per LP, most expensive first', () => {
    let l = addToLedger([], 'gemini-3.8-live', 'ownership', { input: 0, output: 0, audioInput: 1e6, audioOutput: 0 });
    l = addToLedger(l, 'gemini-3.8-live', 'ownership', { input: 0, output: 0, audioInput: 1e6, audioOutput: 0 });
    l = addToLedger(l, 'gemini-3.8-flash', 'bias', { input: 1e6, output: 0, audioInput: 0, audioOutput: 0 });
    l = addToLedger(l, 'gemini-3.8-flash', null, { input: 0, output: 1e6, audioInput: 0, audioOutput: 0 });
    expect(l).toHaveLength(3);
    expect(l[0].calls).toBe(2);
    const s = spend(l, DEFAULT_PRICING, lps);
    expect(s.total).toBeCloseTo(6 + 0.75 + 3.75);
    expect(s.rows.map((r) => [r.label, +r.usd.toFixed(2)])).toEqual([['Ownership', 6], ['Reports & other', 3.75], ['Bias for Action', 0.75]]);
  });

  it('formats dollars', () => {
    expect(fmtUsd(0)).toBe('$0.00');
    expect(fmtUsd(0.0042)).toBe('$0.004');
    expect(fmtUsd(12.345)).toBe('$12.35');
  });

  it('turns Live usageMetadata into a usage event', () => {
    const p = parseServerMessage({ usageMetadata: { promptTokenCount: 10, responseTokenCount: 5 } });
    expect(p.events).toEqual([{ type: 'usage', usageMetadata: { promptTokenCount: 10, responseTokenCount: 5 } }]);
  });

  it('persists usage through the repository', async () => {
    const repo = new MemoryRepo();
    await repo.init();
    await repo.setSettings({ usage: [] });
    await repo.addUsage([{ model: 'gemini-3.8-flash', lpId: 'ownership', usage: { input: 10, output: 5, audioInput: 0, audioOutput: 0 } }]);
    await repo.addUsage([{ model: 'gemini-3.8-flash', lpId: 'ownership', usage: { input: 10, output: 5, audioInput: 0, audioOutput: 0 } }]);
    const s = await repo.settings();
    expect(s.usage).toEqual([{ model: 'gemini-3.8-flash', lpId: 'ownership', calls: 2, input: 20, output: 10, audioInput: 0, audioOutput: 0 }]);
    expect(s.pricing.length).toBeGreaterThan(0);
  });
});
