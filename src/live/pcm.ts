// Mock — PCM helpers for the live connection. Gemini Live takes 16-bit little-endian PCM at
// 16 kHz and returns 16-bit PCM at 24 kHz, both base64 in JSON. Pure functions, unit-tested.

export const INPUT_RATE = 16000;
export const OUTPUT_RATE = 24000;
export const INPUT_MIME = 'audio/pcm;rate=16000';

/** Linear-interpolating resampler; good enough for speech going into a recogniser. */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate;
  const n = Math.floor(input.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x), i1 = Math.min(i0 + 1, input.length - 1);
    const f = x - i0;
    out[i] = input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}

export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function int16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] / (input[i] < 0 ? 0x8000 : 0x7fff);
  return out;
}

/** Root mean square of a frame, 0..1. */
export function rms(input: Float32Array): number {
  if (!input.length) return 0;
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
  return Math.sqrt(sum / input.length);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Int16 samples → base64 of their little-endian bytes (the wire format). */
export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
  return bytesToBase64(bytes);
}

/** base64 little-endian 16-bit PCM → float samples. */
export function base64ToFloat(b64: string): Float32Array {
  const bytes = base64ToBytes(b64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = view.getInt16(i * 2, true); out[i] = v / (v < 0 ? 0x8000 : 0x7fff); }
  return out;
}

/** Sample rate from a mime type like "audio/pcm;rate=24000"; the fallback when absent. */
export function rateOf(mime: string | undefined, fallback = OUTPUT_RATE): number {
  const m = /rate=(\d+)/.exec(mime ?? '');
  return m ? Number(m[1]) : fallback;
}
