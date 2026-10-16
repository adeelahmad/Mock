// Mock — the live connection interface. Three transports implement it: the real Gemini Live
// WebSocket (`gemini.ts`), the speech → model → voice pipeline (`pipeline.ts`), and a simulated
// one that replays scripted events for development, demos and tests. The session controller never knows which one it has.

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  behavior?: 'NON_BLOCKING' | 'BLOCKING';
}
export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export interface ToolResponse { id: string; name: string; response: Record<string, unknown> }

export interface LiveConfig {
  model: string;
  voice: string;
  systemInstruction: string;
  tools: ToolDeclaration[];
  /** End-of-speech silence for the server VAD, ms. */
  silenceDurationMs: number;
  /** Session resumption handle from a previous connection, if any. */
  resumptionHandle?: string | null;
  /** Reproducible variety. */
  seed?: number;
}

export type TransportEvent =
  | { type: 'ready' }
  /** A chunk of model audio was scheduled; `speaking` flips as playback starts and drains. */
  | { type: 'aiSpeaking'; speaking: boolean }
  /** Mic level 0..1 (real: RMS from the worklet; simulated: scripted). */
  | { type: 'level'; value: number }
  | { type: 'inputTranscript'; text: string }
  | { type: 'outputTranscript'; text: string }
  | { type: 'toolCall'; calls: ToolCall[] }
  | { type: 'toolCallCancellation'; ids: string[] }
  | { type: 'interrupted' }
  | { type: 'turnComplete' }
  | { type: 'goAway'; timeLeftMs: number }
  | { type: 'resumption'; handle: string | null; resumable: boolean }
  /** The recap has been spoken: the session is over (simulated only; with Gemini the controller ends on [END] and waits for the recap). */
  | { type: 'sessionEnd'; focus?: string }
  /** The next chunk of the mixed recording (real transport), in order from 0. */
  | { type: 'recordingChunk'; blob: Blob; index: number }
  /** Token counts for the budget (Gemini sends `usageMetadata` periodically, per response). */
  | { type: 'usage'; usageMetadata: unknown; model?: string }
  | { type: 'closed'; code?: number; reason?: string }
  | { type: 'error'; message: string };

export type TransportListener = (e: TransportEvent) => void;

export interface LiveTransport {
  readonly kind: 'gemini' | 'pipeline' | 'simulated';
  connect(config: LiveConfig): Promise<void>;
  /** Text into the conversation: control tags ([START], [REDO] …) or a typed message. */
  sendText(text: string): void;
  sendToolResponse(responses: ToolResponse[]): void;
  /** Mute the mic (paused). The connection stays open. */
  setMuted(muted: boolean): void;
  /** Stop and flush queued model audio (barge-in, pause). */
  stopPlayback(): void;
  /** True while scheduled model audio is still playing. */
  isSpeaking(): boolean;
  close(): void;
  on(listener: TransportListener): () => void;
  /** The mixed recording so far (mic + playback), when the transport records. */
  recordingBlob?(): Promise<Blob | null>;
  /** Start recording a per-exchange clip of the mixed track. */
  beginClip?(): void;
  /** Stop the clip and return it. */
  endClip?(): Promise<Blob | null>;
}

/** The one tool the model calls on every new main question. */
export const NEW_QUESTION_TOOL: ToolDeclaration = {
  name: 'new_question',
  description: 'Call this whenever you ask a new MAIN interview question (not a follow-up), before you speak it. The app pins the question, closes the previous exchange and marks a chapter in the recording.',
  behavior: 'NON_BLOCKING',
  parameters: {
    type: 'OBJECT',
    properties: {
      interviewer: { type: 'STRING', description: 'The interviewer asking, by name (e.g. "Dana Whitfield")' },
      question: { type: 'STRING', description: 'The exact question you will ask' },
      lp: { type: 'STRING', description: 'The area being tested, by its full name' },
      question_id: { type: 'STRING', description: 'The id of the question from the list, if it came from there' },
    },
    required: ['interviewer', 'question', 'lp'],
  },
};

/** Retrieval over the candidate's prep files (resume, notes, past loops). Blocking: the model waits for the chunks. */
export const SEARCH_PREP_TOOL: ToolDeclaration = {
  name: 'search_prep',
  description: "Search the candidate's uploaded prep files (resume, notes, past interview write-ups) for facts relevant to a query. Call it when the candidate is stuck, has no story, or asks for help, then use what comes back to build a STAR story with them. Returns the best passages with their file names.",
  parameters: {
    type: 'OBJECT',
    properties: {
      query: { type: 'STRING', description: 'What to look for: the question, the LP, or a project, team or skill the candidate mentioned' },
      limit: { type: 'INTEGER', description: 'How many passages to return (default 4, max 8)' },
    },
    required: ['query'],
  },
};

/** Saves a story the candidate built with the coach. */
export const SAVE_STORY_TOOL: ToolDeclaration = {
  name: 'save_story',
  description: "Save a STAR story you built together with the candidate to their story library. Call it only after you read the story back and the candidate agreed to keep it.",
  parameters: {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING', description: 'A short title, e.g. "Payments outage rollback"' },
      situation: { type: 'STRING', description: 'Situation, one or two sentences' },
      task: { type: 'STRING', description: 'Task: what the candidate owned' },
      action: { type: 'STRING', description: 'Actions the candidate took, first person' },
      result: { type: 'STRING', description: 'Result, with numbers' },
      learning: { type: 'STRING', description: 'What they learned or would do differently' },
      lp: { type: 'STRING', description: 'The area it best answers, by its full name' },
      numbers: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Key numbers as "label: value", e.g. "latency: -40%"' },
    },
    required: ['title', 'situation', 'task', 'action', 'result'],
  },
};

/** Role swap: the story Mock is telling as the candidate, written on the screen while it speaks. */
export const SHOW_STORY_TOOL: ToolDeclaration = {
  name: 'show_story',
  description: "Role swap only. Call this right after new_question and before you speak your answer: the app writes the story you are about to tell on the screen, with its key numbers large. Use only facts from the candidate's stories and files.",
  behavior: 'NON_BLOCKING',
  parameters: {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING', description: 'The story title, e.g. "Payments outage rollback"' },
      lp: { type: 'STRING', description: 'The area it answers, by its full name' },
      story_id: { type: 'STRING', description: 'The id of the story from the list, if it came from there' },
      headline: { type: 'STRING', description: 'One decisive sentence: the answer in a nutshell, result first' },
      situation: { type: 'STRING', description: 'Situation and task, one or two short sentences' },
      action: { type: 'STRING', description: 'What I did: the key decisions, one to three short sentences' },
      result: { type: 'STRING', description: 'The result, with numbers' },
      learning: { type: 'STRING', description: 'The learning, one sentence' },
      numbers: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Key numbers as "label: value", e.g. "time to mitigate: 41 min"' },
      source: { type: 'STRING', description: 'Where it came from: the story library or the file name' },
    },
    required: ['title', 'headline', 'result'],
  },
};

/** Tiny typed emitter shared by both transports. */
export class Emitter {
  private listeners = new Set<TransportListener>();
  on(l: TransportListener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  emit(e: TransportEvent): void { for (const l of Array.from(this.listeners)) l(e); }
  clear(): void { this.listeners.clear(); }
}
