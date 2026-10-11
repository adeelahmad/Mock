// Mock — handing a file to the user: "Save to…" (File System Access, Chromium desktop),
// "Share…" (Web Share with files, phones), or a plain download. The caller offers the ways
// `saveWays()` reports and passes the chosen one.

export type SaveWay = 'download' | 'share' | 'picker';

interface PickerWindow { showSaveFilePicker?: (o: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }> }

export function saveWays(sample: File | null = null): SaveWay[] {
  const ways: SaveWay[] = ['download'];
  if (typeof window !== 'undefined' && typeof (window as unknown as PickerWindow).showSaveFilePicker === 'function') ways.push('picker');
  try { if (sample && typeof navigator.canShare === 'function' && navigator.canShare({ files: [sample] })) ways.push('share'); } catch { /* not shareable */ }
  return ways;
}

/** Returns false when the user cancelled. */
export async function saveFile(blob: Blob, name: string, way: SaveWay = 'download'): Promise<boolean> {
  if (way === 'picker') {
    const pick = (window as unknown as PickerWindow).showSaveFilePicker!;
    try {
      const ext = name.slice(name.lastIndexOf('.'));
      const h = await pick({ suggestedName: name, types: [{ description: 'Mock backup', accept: { [blob.type || 'application/octet-stream']: [ext] } }] });
      const w = await h.createWritable(); await w.write(blob); await w.close();
      return true;
    } catch (e) { if ((e as Error)?.name === 'AbortError') return false; throw e; }
  }
  if (way === 'share') {
    try { await navigator.share({ files: [new File([blob], name, { type: blob.type })], title: name }); return true; }
    catch (e) { if ((e as Error)?.name === 'AbortError') return false; throw e; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
