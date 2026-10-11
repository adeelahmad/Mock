import { describe, it, expect } from 'vitest';
import { WAVE_FLOOR, waveformPeaks } from './waveform.ts';

describe('waveformPeaks', () => {
  it('scales the loudest bar to 100 and silence to the floor', () => {
    const ch = new Float32Array(4000);
    for (let i = 2000; i < 3000; i++) ch[i] = Math.sin(i) * 0.5;
    const p = waveformPeaks([ch], 4);
    expect(p).toHaveLength(4);
    expect(p[0]).toBe(WAVE_FLOOR);
    expect(p[2]).toBe(100);
  });
  it('handles empty input', () => {
    expect(waveformPeaks([], 3)).toEqual([WAVE_FLOOR, WAVE_FLOOR, WAVE_FLOOR]);
  });
});
