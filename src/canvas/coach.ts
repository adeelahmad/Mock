// Mock — the canvas AI. Two jobs, on whichever language model the providers pick (Gemini by
// default, or an OpenAI-compatible one): mark each heard phrase of an answer (on track /
// drifting / redo, with a few words why), and talk in the canvas chat, where it can also put
// notes on the whiteboard. Without a model (no key, a failed call) the offline judge in
// domain/canvas.ts marks phrases and the chat says what it can.

import type { ChatModel, ChatTurn } from '../llm/chat.ts';
import { parseJsonReply } from '../llm/chat.ts';
import type { ToolDeclaration } from '../live/transport.ts';
import { reportUsage } from '../gemini/usage.ts';
import { localMark, summarize, type CanvasState, type Mark } from '../domain/canvas.ts';
import type { Lp, Story } from '../domain/types.ts';

export interface CoachContext {
  question: string;
  area: Lp | null;
  story: Story | null;
  /** Content words of the reference, for the offline judge. */
  words: Set<string>;
}

const storyText = (s: Story | null): string => s ? `"${s.title}". Situation: ${s.situation} Task: ${s.task} Action: ${s.action} Result: ${s.result}` : '(no story linked to this area yet)';

function contextBlock(c: CoachContext): string {
  return [
    'Question: ' + c.question,
    'Area it tests: ' + (c.area ? c.area.name + (c.area.description ? ' (' + c.area.description + ')' : '') : 'not picked yet'),
    'The candidate\'s own prep story for this area: ' + storyText(c.story),
  ].join('\n');
}

const JUDGE_SYSTEM = `You are an interview coach listening to a candidate answer out loud, phrase by phrase.
For the newest phrase, decide one mark:
- "match": on track for a strong answer to this question and area (a concrete situation, the candidate's own actions, a result, data, or it follows their prep story).
- "drift": related but drifting (general talk, "we" instead of "I", detail that does not serve the question, rambling).
- "redo": wrong for the question, empty, contradicts the area, or so muddled the answer should start again.
Judge the phrase in the context of the answer so far; early setup lines that set the scene are "match".
Reply with JSON only: {"mark":"match|drift|redo","note":"at most 10 words, to the candidate"}.`;

export interface Judged { mark: Mark; note: string; by: 'ai' | 'local' }

/** Marks one phrase. Falls back to the offline judge when there is no model or the call fails. */
export async function judgePhrase(o: { model: ChatModel | null; ctx: CoachContext; before: string[]; phrase: string; signal?: AbortSignal }): Promise<Judged & { error?: string }> {
  const local = (): Judged => ({ ...localMark(o.phrase, o.ctx.words), by: 'local' });
  if (!o.model) return local();
  try {
    const reply = await o.model.complete({
      system: JUDGE_SYSTEM + '\n\n' + contextBlock(o.ctx),
      turns: [{ role: 'user', text: 'Answer so far: ' + (o.before.length ? o.before.join(' ') : '(nothing yet)') + '\nNewest phrase: ' + o.phrase }],
      tools: [], temperature: 0, signal: o.signal,
    });
    if (reply.usage) reportUsage(o.model.model, o.ctx.area?.id ?? null, reply.usage);
    const j = parseJsonReply<{ mark?: string; note?: string }>(reply.text);
    const mark = j.mark === 'match' || j.mark === 'drift' || j.mark === 'redo' ? j.mark : null;
    if (!mark) return { ...local(), error: 'unexpected reply' };
    return { mark, note: String(j.note ?? '').slice(0, 120), by: 'ai' };
  } catch (err) {
    if (o.signal?.aborted) throw err;
    return { ...local(), error: (err as Error).message || 'failed' };
  }
}

// ---------- Chat ----------

export const NOTE_TOOL: ToolDeclaration = {
  name: 'add_note',
  description: 'Put a short note on the shared whiteboard: an outline (STAR headings), a key number, a better opening line, a reminder. Keep each note under 40 words.',
  parameters: { type: 'OBJECT', properties: { text: { type: 'STRING', description: 'The note' } }, required: ['text'] },
};

const CHAT_SYSTEM = `You are Mock, an interview prep partner working with the candidate on a shared canvas.
The canvas shows the question, the area the candidate picked, their spoken answer with each phrase marked (match / drift / redo), and a whiteboard.
You hear everything they say and read what they type. Reply in the chat in at most three short sentences: concrete, kind, direct.
When something is worth keeping in view (an outline, a stronger opening, the number to land), also call add_note to put it on the whiteboard.`;

function canvasView(s: CanvasState, ctx: CoachContext): string {
  const sum = summarize(s.phrases);
  const answer = s.phrases.map((p) => `[${p.mark}] ${p.text}`).join('\n');
  const notes = s.notes.map((n) => '- ' + n.text).join('\n');
  return [
    contextBlock(ctx),
    'Stage: ' + (s.phase === 'pick' ? 'picking the area' : s.phase === 'answer' ? 'answering' : 'answer finished'),
    s.misses.length ? 'Wrong area picks so far: ' + s.misses.length : '',
    answer ? 'Answer so far (' + (sum.overall ?? 'not judged') + '):\n' + answer : 'No answer yet.',
    notes ? 'Whiteboard notes:\n' + notes : '',
  ].filter(Boolean).join('\n');
}

export interface ChatResult { text: string; notes: string[]; error?: string }

/** One chat reply. The last 12 messages go along; notes the model writes come back separately. */
export async function chatReply(o: { model: ChatModel | null; state: CanvasState; ctx: CoachContext; ask?: string; signal?: AbortSignal }): Promise<ChatResult> {
  const last = o.state.chat[o.state.chat.length - 1];
  const said = o.ask ?? last?.text ?? '';
  if (!o.model) return { text: offlineReply(o.state, said, !!o.ask), notes: [] };
  const turns: ChatTurn[] = [];
  for (const m of o.state.chat.slice(-12)) {
    if (m.who === 'me') turns.push({ role: 'user', text: (m.voice ? '(said) ' : '') + m.text });
    else turns.push({ role: 'assistant', text: m.text, calls: [] });
  }
  // The app's own ask ("how was that answer?") goes last without showing in the chat.
  if (o.ask) turns.push({ role: 'user', text: o.ask });
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length) turns.push({ role: 'user', text: 'Hi' });
  try {
    const system = CHAT_SYSTEM + '\n\nThe canvas now:\n' + canvasView(o.state, o.ctx);
    let reply = await o.model.complete({ system, turns, tools: [NOTE_TOOL], temperature: 0.4, signal: o.signal });
    if (reply.usage) reportUsage(o.model.model, o.ctx.area?.id ?? null, reply.usage);
    const notes = reply.calls.filter((c) => c.name === 'add_note').map((c) => String(c.args.text ?? '').trim()).filter(Boolean);
    let text = reply.text;
    // A reply that was only tool calls: give the results back once for the words that go with them.
    if (!text && reply.calls.length) {
      const more: ChatTurn[] = [...turns, { role: 'assistant', text: '', calls: reply.calls, raw: reply.raw }, { role: 'tool', results: reply.calls.map((c) => ({ id: c.id, name: c.name, response: { ok: true } })) }];
      reply = await o.model.complete({ system, turns: more, tools: [NOTE_TOOL], temperature: 0.4, signal: o.signal });
      if (reply.usage) reportUsage(o.model.model, o.ctx.area?.id ?? null, reply.usage);
      text = reply.text;
    }
    return { text: text || (notes.length ? 'Added to the whiteboard.' : '…'), notes };
  } catch (err) {
    if (o.signal?.aborted) throw err;
    return { text: offlineReply(o.state, said, !!o.ask), notes: [], error: (err as Error).message || 'failed' };
  }
}

/** What the chat can say with no model: the state of the answer and a next step. */
export function offlineReply(s: CanvasState, said: string, review = false): string {
  if (s.phase === 'pick' && !review) return 'Pick the area this question tests first. Which principle would the interviewer write on their sheet?';
  const sum = summarize(s.phrases);
  if (/\b(outline|structure|star)\b/i.test(said)) return 'Situation in one line, your task, three actions in the first person, then the result with a number.';
  if (!s.phrases.length) return 'Say your answer out loud; I mark each phrase as you go.';
  const counts = sum.match + ' on track, ' + sum.drift + ' drifting, ' + sum.redo + ' to redo.';
  if (review) return (sum.overall === 'match' ? 'Good answer. ' : sum.overall === 'redo' ? 'Try this one again. ' : 'Close, but it drifted. ') + counts + ' ' + sum.line;
  return sum.line + ' (' + counts + ') Add a Gemini key for a real coach here.';
}
