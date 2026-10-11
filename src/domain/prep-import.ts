// Mock — prep import: what happens to files dropped on first run or in Library → Upload.
// Markdown/text become prep files (with any questions in them), story files become stories,
// CSV becomes areas, stories or questions by its header (csv-templates.ts), Exponent exports (JSON, or the zstd-compressed `.zst` export) become questions, and a
// Mock backup restores. Parsing is `parsers.ts`; this file decides and writes through the repo.

import { decompress } from 'fzstd';
import { newId, type Repo } from '../db/repo.ts';
import { applyBackup, readBackupFile, BackupError } from '../db/backup.ts';
import type { FileType, Lp, PrepFile, Question, QuestionSource, Story } from './types.ts';
import { csvKind, detectFileType, parseAreasFromCsv, parseExponentRows, parseQuestionsFromCsv, parseStoriesFromCsv, parseStoriesFromMarkdown, parsedQuestionsFromText, resolveLp, type ParsedArea, type ParsedQuestion, type ParsedStory } from './parsers.ts';

export const plural = (n: number, one: string, many = one + 's'): string => n + ' ' + (n === 1 ? one : many);

const TEXT_EXT = ['md', 'markdown', 'txt', 'text', 'csv', 'json', 'zst'];
const BACKUP_EXT = ['zip', 'mockbackup'];

/** Bytes → text; `.zst` is decompressed first (the full Exponent export ships that way). */
export async function fileText(f: Blob & { name?: string }): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  const zst = /\.zst$/i.test(f.name ?? '') || (buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd);
  return new TextDecoder().decode(zst ? decompress(buf) : buf);
}

export interface PrepImport {
  files: number;
  skipped: string[];
  restored: number;
  /** Areas set from an areas CSV (0 when none was imported). */
  areas: number;
  stories: { count: number; lps: number; numbers: number };
  questions: { count: number; tagged: number; toCheck: number };
  /** One row per stored file: the type label the design shows and a one-line sub. */
  types: { type: FileType; name: string; sub: string }[];
}
const MONTH = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\s+\d{4}\b/i;
const firstHeading = (text: string): string => (/^#{1,3}\s+(.+?)\s*#*\s*$/m.exec(text)?.[1] ?? '').replace(/\*\*|__/g, '').trim();
const shorten = (s: string, n = 34): string => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
function subFor(type: FileType, text: string): string {
  if (type === 'JD') { const h = firstHeading(text); return h ? shorten(h.replace(/^(senior|sr\.?)\s+software development manager/i, 'Senior SDM').replace(/,\s*/g, ' · ')) : 'included in prep'; }
  if (type === 'Past interviews') {
    const rounds = (text.match(/^#{1,6}\s*round\b/gim) ?? []).length;
    const month = MONTH.exec(text)?.[0] ?? '';
    const parts = [month, rounds ? plural(rounds, 'round') : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'included in prep';
  }
  return 'included in prep';
}
export const typeLabel = (type: FileType): string => ({ JD: 'Job description', 'Past interviews': 'Past loop notes', Background: 'Background', Other: 'Notes' })[type];
const toQuestion = (q: ParsedQuestion, source: QuestionSource, at: string): Question => ({
  id: newId('q'), text: q.text, lpIds: q.lpId ? [q.lpId] : [], source: q.source ?? source, difficulty: q.difficulty ?? 2, timesAsked: 0, lastVerdict: null, bestExchangeId: null, tags: q.tags, votes: q.votes, sample: q.sample, createdAt: at,
});

/** Parsed areas → the new area list. An area that matches an existing one (id, short or name) keeps its id, so links survive. */
export function areasFromParsed(parsed: ParsedArea[], existing: Lp[]): Lp[] {
  const used = new Set<string>();
  return parsed.map((a, i) => {
    let id = resolveLp(a.name, existing) || resolveLp(a.id, existing) || a.id || 'area' + (i + 1);
    while (used.has(id)) id += '_' + (i + 1);
    used.add(id);
    const old = existing.find((l) => l.id === id);
    return { id, name: a.name, short: a.short || old?.short || a.name.slice(0, 2).toUpperCase(), description: a.description || old?.description || '', order: i, isDefault: false };
  });
}

export async function importPrepFiles(list: File[], ctx: { repo: Repo; lps: Lp[]; stories: Story[]; files: PrepFile[] }): Promise<PrepImport> {
  const { repo, lps } = ctx;
  const out: PrepImport = { files: 0, skipped: [], restored: 0, areas: 0, stories: { count: 0, lps: 0, numbers: 0 }, questions: { count: 0, tagged: 0, toCheck: 0 }, types: [] };
  const titles = new Set(ctx.stories.map((s) => s.title.toLowerCase()));
  const lpSet = new Set<string>();
  const at = new Date().toISOString();
  const addStories = async (stories: ParsedStory[]) => {
    for (const s of stories) {
      if (titles.has(s.title.toLowerCase())) continue;
      titles.add(s.title.toLowerCase());
      const links = s.suggestedLpIds.map((lpId, i) => ({ lpId, role: i === 0 ? 'primary' as const : 'secondary' as const }));
      links.forEach((l) => lpSet.add(l.lpId));
      await repo.upsertStory({ id: newId('st'), title: s.title, summary: s.summary, situation: s.situation, task: s.task, action: s.action, result: s.result, learning: s.learning, numbers: s.numbers, links, createdAt: at, updatedAt: at });
      out.stories.count++; out.stories.numbers += s.numbers.length;
    }
  };
  let areas = lps;
  for (const f of list) {
    const name = f.name.split('/').pop() ?? f.name;
    if (name.startsWith('.')) continue;
    const ex = (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]) ?? '';
    if (BACKUP_EXT.includes(ex)) {
      try { await applyBackup(repo, await readBackupFile(new Uint8Array(await f.arrayBuffer())), 'replace'); out.restored++; out.files++; }
      catch (e) { out.skipped.push(name + (e instanceof BackupError && e.code === 'encrypted' ? ' (restore it in Settings with its passphrase)' : '')); }
      continue;
    }
    if (!TEXT_EXT.includes(ex)) { out.skipped.push(name); continue; }
    let text: string;
    try { text = await fileText(f); } catch { out.skipped.push(name); continue; }
    let rows: ParsedQuestion[] = [];
    let source: QuestionSource = 'custom';
    if (ex === 'json' || ex === 'zst') {
      try { await applyBackup(repo, await readBackupFile(new TextEncoder().encode(text)), 'replace'); out.restored++; out.files++; continue; } catch { /* not a Mock backup */ }
      const bank = parseExponentRows(text, areas);
      if (bank) { rows = bank; source = 'common'; } else rows = parsedQuestionsFromText(text, 'custom', areas);
    } else if (ex === 'csv') {
      const kind = csvKind(text);
      if (kind === 'areas') {
        const parsed = parseAreasFromCsv(text);
        if (parsed.length) { areas = areasFromParsed(parsed, areas); await repo.setLps(areas); out.areas = areas.length; out.files++; } else out.skipped.push(name);
        continue;
      }
      if (kind === 'stories') { await addStories(parseStoriesFromCsv(text, areas)); out.files++; continue; }
      rows = parseQuestionsFromCsv(text, areas);
    } else {
      const type = detectFileType(text);
      const stories = type === 'Other' || /stor/i.test(name) ? parseStoriesFromMarkdown(text, areas) : [];
      if (stories.length && stories.some((s) => s.situation || s.action || s.result || s.numbers.length >= 2)) {
        await addStories(stories);
        out.files++;
        continue;
      }
      source = type === 'Past interviews' ? 'previous' : 'custom';
      const existing = ctx.files.find((x) => x.name === name);
      await repo.upsertFile({ id: existing?.id ?? newId('f'), name, type, content: text, included: true, size: f.size || text.length, updatedAt: at, summary: null });
      out.types.push({ type, name, sub: subFor(type, text) });
      rows = parsedQuestionsFromText(text, source, areas);
    }
    out.files++;
    if (rows.length) {
      const added = await repo.addQuestions(rows.map((r) => toQuestion(r, source, at)));
      const high = rows.filter((r) => r.lpId && r.confidence === 'high').length;
      out.questions.count += added; out.questions.tagged += Math.min(added, high); out.questions.toCheck += Math.max(0, added - Math.min(added, high));
    }
  }
  out.stories.lps = lpSet.size;
  return out;
}
export const importSummary = (r: PrepImport): string => {
  const bits = [plural(r.files, 'file'), plural(r.questions.count, 'question')];
  if (r.areas) bits.push(plural(r.areas, 'area'));
  if (r.stories.count) bits.push(plural(r.stories.count, 'story', 'stories'));
  if (r.restored) bits.push(r.restored === 1 ? 'a Mock export restored' : r.restored + ' Mock exports restored');
  if (r.skipped.length) bits.push(r.skipped.length + ' skipped (' + r.skipped.slice(0, 2).join(', ') + (r.skipped.length > 2 ? '…' : '') + ')');
  return 'Imported ' + bits.join(' · ');
};

