import { describe, it, expect } from 'vitest';
import { resample, floatToInt16, int16ToFloat, rms, int16ToBase64, base64ToFloat, rateOf, bytesToBase64, base64ToBytes } from './pcm.ts';

describe('pcm helpers', () => {
  it('resamples 48 kHz to 16 kHz at a third of the length, keeping a ramp linear', () => {
    const src = new Float32Array(480).map((_, i) => i / 480);
    const out = resample(src, 48000, 16000);
    expect(out.length).toBe(160);
    expect(out[10]).toBeCloseTo(30 / 480, 5);
  });
  it('clamps and round-trips int16', () => {
    const s = floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    expect(Array.from(s)).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
    const f = int16ToFloat(s);
    expect(f[1]).toBe(1); expect(f[2]).toBe(-1); expect(f[5]).toBeCloseTo(0.5, 3);
  });
  it('encodes little-endian base64 and decodes it back', () => {
    const s = new Int16Array([1, -2, 32767, -32768]);
    const b64 = int16ToBase64(s);
    expect(Array.from(base64ToBytes(b64))).toEqual([1, 0, 254, 255, 255, 127, 0, 128]);
    const f = base64ToFloat(b64);
    expect(f[2]).toBe(1); expect(f[3]).toBe(-1);
  });
  it('base64 handles buffers larger than one chunk', () => {
    const big = new Uint8Array(100_000).map((_, i) => i & 255);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });
  it('measures rms and reads the rate from a mime type', () => {
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rms(new Float32Array())).toBe(0);
    expect(rateOf('audio/pcm;rate=24000')).toBe(24000);
    expect(rateOf('audio/pcm', 16000)).toBe(16000);
  });
});
