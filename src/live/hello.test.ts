import { describe, it, expect } from 'vitest';
import { suggestPause } from './hello.ts';

describe('pause suggestion from the hello test', () => {
  it('takes the longest gap between phrases, padded and rounded', () => {
    const s: [number, number][] = [[0, 0], [100, 0.2], [900, 0.01], [1700, 0.2], [2000, 0.01], [2600, 0.2], [3000, 0.01], [9000, 0]];
    expect(suggestPause(s)).toBe(1500); // longest inner gap 800 ms + 700
  });
  it('clamps to the slider and returns null without speech gaps', () => {
    expect(suggestPause([[0, 0.2], [100, 0], [5000, 0.2]])).toBe(4000);
    expect(suggestPause([[0, 0.2], [100, 0]])).toBeNull();
    expect(suggestPause([])).toBeNull();
  });
});
