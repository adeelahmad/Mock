// Mock — Gemini as the pipeline's language model: `generateContent` over REST with function
// calling, the conversation sent as `contents` (user / model turns, function responses as user
// parts). Used when speech in or out is not Gemini but the model is; Gemini Live is not
// involved. The model's own parts are sent back unchanged so thought signatures survive.

import { GEMINI_BASE } from '../gemini/flash.ts';
import type { ToolCall } from '../live/transport.ts';
import { LlmError, timedFetch, type ChatModel, type ChatReply, type ChatRequest, type ChatTurn } from './chat.ts';

export interface GeminiChatConfig { key: string; model: string; fetch?: typeof fetch; timeoutMs?: number }

type Part = Record<string, unknown>;

export function toContents(turns: ChatTurn[]): { role: string; parts: Part[] }[] {
  return turns.map((t) => {
    if (t.role === 'user') return { role: 'user', parts: [{ text: t.text }] };
    if (t.role === 'assistant') {
      if (Array.isArray(t.raw) && t.raw.length) return { role: 'model', parts: t.raw as Part[] };
      const parts: Part[] = t.text ? [{ text: t.text }] : [];
      for (const c of t.calls) parts.push({ functionCall: { name: c.name, args: c.args ?? {}, ...(c.id && !c.id.startsWith('gcall_') ? { id: c.id } : {}) } });
      return { role: 'model', parts };
    }
    return {
      role: 'user',
      parts: t.results.map((r) => {
        const { scheduling: _s, ...response } = r.response as { scheduling?: unknown };
        return { functionResponse: { name: r.name, response, ...(r.id && !r.id.startsWith('gcall_') ? { id: r.id } : {}) } };
      }),
    };
  });
}

let seq = 0;

export class GeminiChat implements ChatModel {
  readonly model: string;
  constructor(private c: GeminiChatConfig) { this.model = c.model; }

  async complete(r: ChatRequest): Promise<ChatReply> {
    const generationConfig: Record<string, unknown> = {};
    if (r.temperature != null) generationConfig.temperature = r.temperature;
    if (r.seed != null) generationConfig.seed = r.seed;
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: r.system }] },
      contents: toContents(r.turns),
      generationConfig,
    };
    if (r.tools.length) body.tools = [{ functionDeclarations: r.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
    const res = await timedFetch(this.c.fetch ?? fetch, GEMINI_BASE + '/models/' + encodeURIComponent(this.c.model.replace(/^models\//, '')) + ':generateContent', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.c.key }, body: JSON.stringify(body),
    }, this.c.timeoutMs ?? 60_000, r.signal);
    const json = (await res.json().catch(() => null)) as { error?: { message?: string }; candidates?: { content?: { parts?: Part[] } }[]; usageMetadata?: Record<string, number> } | null;
    if (!res.ok) throw new LlmError(json?.error?.message || 'Gemini returned ' + res.status, res.status);
    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text as string).join('').trim();
    const calls: ToolCall[] = parts.filter((p) => p.functionCall).map((p) => {
      const f = p.functionCall as { id?: string; name?: string; args?: Record<string, unknown> };
      return { id: f.id || 'gcall_' + ++seq, name: String(f.name ?? ''), args: f.args ?? {} };
    });
    return { text, calls, usage: json?.usageMetadata ?? null, raw: parts };
  }
}
