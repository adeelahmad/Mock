// Mock — the live connection interface. Two transports implement it: the real Gemini Live
// WebSocket (`gemini.ts`) and a simulated one that replays scripted events for development, demos
// and tests. The session controller never knows which one it has.

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
  | { type: 'usage'; usageMetadata: unknown }
  | { type: 'closed'; code?: number; reason?: string }
  | { type: 'error'; message: string };

export type TransportListener = (e: TransportEvent) => void;

export interface LiveTransport {
  readonly kind: 'gemini' | 'simulated';
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

/** Tiny typed emitter shared by both transports. */
export class Emitter {
  private listeners = new Set<TransportListener>();
  on(l: TransportListener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  emit(e: TransportEvent): void { for (const l of Array.from(this.listeners)) l(e); }
  clear(): void { this.listeners.clear(); }
}
