import { describe, it, expect } from 'vitest';
import { readinessFor, practiceQueue, type VerdictSample } from './readiness.ts';

const at = (n: number) => new Date(Date.UTC(2026, 9, n)).toISOString();
const s = (lpId: string, sessionNumber: number, verdict: VerdictSample['verdict']): VerdictSample => ({ lpId, sessionNumber, verdict, at: at(sessionNumber) });

describe('readiness', () => {
  it('is null for an LP never tested', () => {
    const [r] = readinessFor([], ['deep'], 14);
    expect(r.readiness).toBeNull();
    expect(r.latest).toBeNull();
  });

  it('maps a single verdict onto 0..1', () => {
    expect(readinessFor([s('deep', 14, 'strong_hire')], ['deep'], 14)[0].readiness).toBe(1);
    expect(readinessFor([s('deep', 14, 'inclined')], ['deep'], 14)[0].readiness).toBeCloseTo(2 / 3);
    expect(readinessFor([s('deep', 14, 'not_inclined')], ['deep'], 14)[0].readiness).toBeCloseTo(1 / 3);
    expect(readinessFor([s('deep', 14, 'strong_no_hire')], ['deep'], 14)[0].readiness).toBe(0);
  });

  it('weights the latest session most (half-life of three sessions)', () => {
    // strong hire now, strong no hire three sessions ago → weights 1 and 0.5 → (4 + 0.5) / 1.5 = 3 → 2/3
    const r = readinessFor([s('deep', 14, 'strong_hire'), s('deep', 11, 'strong_no_hire')], ['deep'], 14)[0];
    expect(r.readiness).toBeCloseTo(2 / 3);
    expect(r.latest).toBe('strong_hire');
    expect(r.lastSessionNumber).toBe(14);
    // the same two verdicts the other way round score lower
    const r2 = readinessFor([s('deep', 14, 'strong_no_hire'), s('deep', 11, 'strong_hire')], ['deep'], 14)[0];
    expect(r2.readiness).toBeCloseTo(1 / 3);
  });

  it('ignores samples outside the eight-session window', () => {
    const r = readinessFor([s('deep', 14, 'inclined'), s('deep', 5, 'strong_no_hire')], ['deep'], 14)[0];
    expect(r.readiness).toBeCloseTo(2 / 3);
    expect(r.samples).toBe(1);
  });

  it('keeps the latest verdict as the display verdict even when the mean says otherwise', () => {
    const r = readinessFor([s('deep', 14, 'not_inclined'), s('deep', 13, 'strong_hire'), s('deep', 12, 'strong_hire')], ['deep'], 14)[0];
    expect(r.latest).toBe('not_inclined');
    expect(r.readiness!).toBeGreaterThan(1 / 3);
  });
});

describe('practice queue', () => {
  const now = new Date(Date.UTC(2026, 9, 16));
  const list = readinessFor([
    s('co', 14, 'inclined'), s('own', 14, 'strong_hire'), s('deep', 14, 'not_inclined'), s('trust', 8, 'inclined'), s('big', 2, 'not_inclined'),
  ], ['co', 'own', 'deep', 'trust', 'big', 'learn'], 14);

  it('ranks weakest readiness first, then stalest', () => {
    const q = practiceQueue(list, now, { limit: 6 });
    expect(q.map((x) => x.lpId)).toEqual(['deep', 'big', 'learn', 'trust', 'co', 'own']);
    expect(q[0].reason).toBe('Not inclined last time');  // not inclined this session → lowest readiness
    expect(q[1].reason).toBe('Never practised');         // never tested (or outside the window) sorts at 0.35, alphabetical
    expect(q[2].reason).toBe('Never practised');
    const trust = q.find((x) => x.lpId === 'trust')!;
    expect(trust.reason).toMatch(/Not practised in \d+ days/);
  });

  it('pulls the last report focus to the top without duplicating it', () => {
    const q = practiceQueue(list, now, { focusLpId: 'co', limit: 3 });
    expect(q[0]).toMatchObject({ lpId: 'co', reason: 'Last session’s focus' });
    expect(q.filter((x) => x.lpId === 'co')).toHaveLength(1);
    expect(q).toHaveLength(3);
  });

  it('big (outside the window) counts as never practised', () => {
    const big = list.find((r) => r.lpId === 'big')!;
    expect(big.readiness).toBeNull();
  });
});
