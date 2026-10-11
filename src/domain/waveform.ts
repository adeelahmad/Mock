// Mock — waveform bars for the History player, from the decoded recording. Pure so it is
// testable: channels of samples in, `n` bar heights (0–100) out. Each bar is the RMS of its
// slice, scaled against the loudest bar with a square-root curve so quiet speech still shows;
// a floor keeps silent bars visible as a line.

export const WAVE_FLOOR = 6;

export function waveformPeaks(channels: Float32Array[], n: number): number[] {
  const len = channels[0]?.length ?? 0;
  if (!len || n <= 0) return Array.from({ length: Math.max(0, n) }, () => WAVE_FLOOR);
  const rms: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * len) / n), b = Math.max(a + 1, Math.floor(((i + 1) * len) / n));
    // Stride long slices: a 40-minute recording has millions of samples per bar set.
    const step = Math.max(1, Math.floor((b - a) / 2048));
    let sum = 0, count = 0;
    for (let j = a; j < b; j += step) {
      let x = 0;
      for (const ch of channels) x += ch[j] ?? 0;
      x /= channels.length;
      sum += x * x; count++;
    }
    rms.push(Math.sqrt(sum / Math.max(1, count)));
  }
  const max = Math.max(...rms);
  if (max <= 0) return rms.map(() => WAVE_FLOOR);
  return rms.map((r) => Math.round(WAVE_FLOOR + (100 - WAVE_FLOOR) * Math.sqrt(r / max)));
}
