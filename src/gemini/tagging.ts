// Mock — batch area tagging for imported questions. Rows the keyword tagger is unsure about go to
// Gemini Flash in batches with the areas; its answer replaces the guess only when it names a
// real area. Offline, without a key, or on any error the keyword guesses stand — this never throws.

import type { ParsedQuestion } from '../domain/parsers.ts';
import type { Lp } from '../domain/types.ts';
import { generateJson } from './rest.ts';

const BATCH = 60;

interface TagReply { tags: { i: number; lp: string; confidence: 'high' | 'low'; alternatives?: string[] }[] }

export const tagSchema = (lpIds: string[]) => ({
  type: 'object',
  properties: {
    tags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer', description: 'The question number' },
          lp: { type: 'string', enum: [...lpIds, ''], description: 'The best area id, or empty when none fits' },
          confidence: { type: 'string', enum: ['high', 'low'] },
          alternatives: { type: 'array', items: { type: 'string', enum: lpIds }, maxItems: 2 },
        },
        required: ['i', 'lp', 'confidence'],
      },
    },
  },
  required: ['tags'],
});

export interface TagResult { rows: ParsedQuestion[]; byGemini: number; error: string | null }

export async function tagWithGemini(rows: ParsedQuestion[], lps: Lp[], o: { key: string; model: string; fetchImpl?: typeof fetch; onlyUnsure?: boolean }): Promise<TagResult> {
  const out = rows.map((r) => ({ ...r }));
  if (!o.key || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { rows: out, byGemini: 0, error: null };
  const ids = lps.map((l) => l.id);
  const todo = out.map((r, i) => ({ r, i })).filter(({ r }) => !(o.onlyUnsure ?? true) || !(r.lpId && r.confidence === 'high'));
  const lpList = lps.map((l) => `${l.id}: ${l.name} — ${l.description}`).join('\n');
  let byGemini = 0;
  try {
    for (let s = 0; s < todo.length; s += BATCH) {
      const batch = todo.slice(s, s + BATCH);
      const prompt = `Tag each interview question with the area (competency or principle) it most directly tests.\n\nAreas (id: name — description):\n${lpList}\n\nQuestions:\n${batch.map((b, j) => `${j + 1}. ${b.r.text}`).join('\n')}\n\nAnswer for every question number. Use "high" confidence only when one area clearly fits.`;
      const reply = await generateJson<TagReply>({ key: o.key, model: o.model, prompt, schema: tagSchema(ids), fetchImpl: o.fetchImpl });
      for (const t of reply.tags ?? []) {
        const b = batch[t.i - 1];
        if (!b || !ids.includes(t.lp)) continue;
        out[b.i] = { ...out[b.i], lpId: t.lp, confidence: t.confidence === 'high' ? 'high' : 'low', alternatives: (t.alternatives ?? []).filter((a) => a !== t.lp && ids.includes(a)) };
        byGemini++;
      }
    }
    return { rows: out, byGemini, error: null };
  } catch (e) {
    return { rows: out, byGemini, error: e instanceof Error ? e.message : String(e) };
  }
}
