// Mock — the Gemini Live wire protocol (BidiGenerateContent over WebSocket), as pure
// functions: the setup message, client messages, and server message → transport events.
// Field names follow https://ai.google.dev/gemini-api/docs/live-guide (checked 2026-10-10).

import type { LiveConfig, ToolCall, ToolResponse, TransportEvent } from './transport.ts';

const HOST = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage';

export type LiveAuth = { kind: 'key'; key: string } | { kind: 'token'; token: string };

/** The WebSocket URL. A raw key goes on v1beta; an ephemeral token on the constrained v1alpha endpoint. */
export function liveUrl(auth: LiveAuth): string {
  return auth.kind === 'key'
    ? `${HOST}.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(auth.key)}`
    : `${HOST}.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(auth.token)}`;
}

/** Sliding-window compression starts here; without it audio sessions stop at 15 minutes. */
export const COMPRESSION_TRIGGER_TOKENS = 100_000;

export interface SetupOptions {
  /** Ask for input/output transcription (always on in sessions; the hello test turns input off). */
  transcribeInput?: boolean;
}

export function setupMessage(c: LiveConfig, o: SetupOptions = {}): Record<string, unknown> {
  const model = c.model.startsWith('models/') ? c.model : 'models/' + c.model;
  const generationConfig: Record<string, unknown> = {
    responseModalities: ['AUDIO'],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: c.voice } } },
  };
  if (c.seed != null) generationConfig.seed = c.seed;
  const setup: Record<string, unknown> = {
    model,
    generationConfig,
    systemInstruction: { parts: [{ text: c.systemInstruction }] },
    realtimeInputConfig: { automaticActivityDetection: { disabled: false, silenceDurationMs: Math.round(c.silenceDurationMs) } },
    outputAudioTranscription: {},
    sessionResumption: c.resumptionHandle ? { handle: c.resumptionHandle } : {},
    contextWindowCompression: { slidingWindow: {}, triggerTokens: COMPRESSION_TRIGGER_TOKENS },
  };
  if (o.transcribeInput !== false) setup.inputAudioTranscription = {};
  if (c.tools.length) {
    setup.tools = [{ functionDeclarations: c.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters, ...(t.behavior ? { behavior: t.behavior } : {}) })) }];
  }
  return { setup };
}

export const audioMessage = (base64Pcm: string, mimeType: string): Record<string, unknown> => ({ realtimeInput: { audio: { data: base64Pcm, mimeType } } });

/** A user text turn: control tags ([START], [REDO] …) and typed messages. */
export const textMessage = (text: string): Record<string, unknown> => ({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } });

/** `scheduling` belongs on the function response, not inside `response`; lift it there. */
export function toolResponseMessage(responses: ToolResponse[]): Record<string, unknown> {
  return {
    toolResponse: {
      functionResponses: responses.map(({ id, name, response }) => {
        const { scheduling, ...rest } = response as { scheduling?: unknown };
        return { id, name, response: rest, ...(typeof scheduling === 'string' ? { scheduling } : {}) };
      }),
    },
  };
}

/** "10s", "1.5s", or a protobuf Duration object → ms. */
export function durationMs(v: unknown): number {
  if (typeof v === 'string') { const m = /^([\d.]+)s$/.exec(v.trim()); return m ? Math.round(Number(m[1]) * 1000) : 0; }
  if (v && typeof v === 'object') { const d = v as { seconds?: number | string; nanos?: number }; return Number(d.seconds ?? 0) * 1000 + Math.round((d.nanos ?? 0) / 1e6); }
  return 0;
}

export interface ParsedServer {
  /** Transport events in arrival order. Model audio is returned separately for the player. */
  events: TransportEvent[];
  audio: { data: string; mimeType: string }[];
  setupComplete: boolean;
}

interface Part { inlineData?: { data?: string; mimeType?: string }; text?: string }

export function parseServerMessage(msg: unknown): ParsedServer {
  const out: ParsedServer = { events: [], audio: [], setupComplete: false };
  if (!msg || typeof msg !== 'object') return out;
  const m = msg as Record<string, any>;
  if (m.setupComplete) out.setupComplete = true;
  const sc = m.serverContent;
  if (sc) {
    if (sc.interrupted) out.events.push({ type: 'interrupted' });
    for (const p of (sc.modelTurn?.parts ?? []) as Part[]) {
      if (p.inlineData?.data && (p.inlineData.mimeType ?? 'audio/pcm').startsWith('audio/')) out.audio.push({ data: p.inlineData.data, mimeType: p.inlineData.mimeType ?? 'audio/pcm;rate=24000' });
    }
    if (sc.inputTranscription?.text) out.events.push({ type: 'inputTranscript', text: sc.inputTranscription.text });
    if (sc.outputTranscription?.text) out.events.push({ type: 'outputTranscript', text: sc.outputTranscription.text });
    if (sc.turnComplete) out.events.push({ type: 'turnComplete' });
  }
  if (m.toolCall?.functionCalls?.length) {
    const calls: ToolCall[] = m.toolCall.functionCalls.map((f: any) => ({ id: String(f.id ?? ''), name: String(f.name ?? ''), args: (f.args ?? {}) as Record<string, unknown> }));
    out.events.push({ type: 'toolCall', calls });
  }
  if (m.toolCallCancellation?.ids?.length) out.events.push({ type: 'toolCallCancellation', ids: m.toolCallCancellation.ids.map(String) });
  if (m.goAway) out.events.push({ type: 'goAway', timeLeftMs: durationMs(m.goAway.timeLeft) });
  if (m.sessionResumptionUpdate) {
    const u = m.sessionResumptionUpdate;
    out.events.push({ type: 'resumption', handle: u.newHandle ?? null, resumable: !!u.resumable });
  }
  if (m.error) out.events.push({ type: 'error', message: String(m.error.message ?? m.error) });
  return out;
}
