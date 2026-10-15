// Mock — the canvas as a Google Meet add-on (Meet Add-ons SDK). Meet loads the app in an
// iframe: the side panel shows a button that opens the canvas on the main stage for everyone
// in the call, and the main stage runs the canvas. Whoever started it drives (their browser
// hears them and runs the AI); everyone else in the call sees the same canvas through the SDK's
// co-doing state. The SDK is Google's hosted script (its licence is Google's terms, so the app
// does not bundle it), loaded only inside Meet; the npm package supplies the types.
// Setup (Cloud project, deployment with the side panel and main stage URLs): docs/canvas.md.

import type { AddonSession, CoDoingClient, FrameType, MeetAddon, MeetMainStageClient, MeetSidePanelClient } from '@googleworkspace/meet-addons';
import { decodeCanvas, encodeCanvas, type CanvasState } from '../domain/canvas.ts';

/** Meet adds `meet_sdk` to an add-on frame's URL; the deployment adds `addon=side|stage` and `project`. */
export interface AddonParams { inMeet: boolean; frame: 'side' | 'stage' | null; project: string }

export function addonParams(search: string, envProject = ''): AddonParams {
  const q = new URLSearchParams(search);
  const frame = q.get('addon');
  return {
    inMeet: q.has('meet_sdk'),
    frame: frame === 'side' || frame === 'stage' ? frame : null,
    project: (q.get('project') || envProject).trim(),
  };
}

export const ADDON = addonParams(typeof location !== 'undefined' ? location.search : '', String(import.meta.env?.VITE_MEET_CLOUD_PROJECT ?? ''));

/** The main stage URL for this deployment: the same app, opened on the canvas. */
export function stageUrl(loc: { origin: string; pathname: string }, project: string): string {
  return loc.origin + loc.pathname + '?addon=stage' + (project ? '&project=' + encodeURIComponent(project) : '') + '#/canvas';
}

/** A Meet meeting code → its link (for the Media API listener). */
export const meetingLink = (code: string): string => 'https://meet.google.com/' + code.trim().toLowerCase();

export const SDK_URL = 'https://www.gstatic.com/meetjs/addons/1.1.0/meet.addons.js';

let sdk: Promise<MeetAddon> | null = null;
function loadSdk(): Promise<MeetAddon> {
  sdk ??= new Promise<MeetAddon>((resolve, reject) => {
    const w = window as unknown as { meet?: { addon?: MeetAddon } };
    if (w.meet?.addon) { resolve(w.meet.addon); return; }
    const el = document.createElement('script');
    el.src = SDK_URL; el.async = true;
    el.onload = () => (w.meet?.addon ? resolve(w.meet.addon) : reject(new Error('The Meet add-on SDK did not load')));
    el.onerror = () => { sdk = null; reject(new Error('Could not load the Meet add-on SDK')); };
    document.head.appendChild(el);
  });
  return sdk;
}

let session: Promise<AddonSession> | null = null;
async function addonSession(project: string): Promise<AddonSession> {
  if (!project) throw new Error('The add-on URL needs ?project=<Cloud project number>');
  session ??= loadSdk().then((a) => a.createAddonSession({ cloudProjectNumber: project }));
  return session;
}

export async function frameType(): Promise<FrameType> { return (await loadSdk()).getFrameType(); }

export async function sidePanel(project: string): Promise<MeetSidePanelClient> { return (await addonSession(project)).createSidePanelClient(); }
export async function mainStage(project: string): Promise<MeetMainStageClient> { return (await addonSession(project)).createMainStageClient(); }

/**
 * The shared canvas: `share(state)` sends it to everyone (throttled), `onState` receives theirs.
 * The SDK resolves conflicts as last writer wins, which suits one driver and several viewers.
 */
export class SharedCanvas {
  onState: ((s: CanvasState) => void) | null = null;
  private client: CoDoingClient | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: CanvasState | null = null;
  private lastSent = 0;

  constructor(private minGapMs = 250) {}

  async connect(project: string, open = (p: string) => addonSession(p)): Promise<void> {
    const s = await open(project);
    this.client = await s.createCoDoingClient({
      activityTitle: 'Mock canvas',
      onCoDoingStateChanged: (st) => { const c = decodeCanvas(st.bytes); if (c) this.onState?.(c); },
    });
  }

  /** For tests: a client stand-in. */
  attach(client: CoDoingClient): void { this.client = client; }

  share(s: CanvasState, now = Date.now()): void {
    if (!this.client) return;
    this.pending = s;
    const wait = this.lastSent + this.minGapMs - now;
    if (wait <= 0) { this.flush(now); return; }
    this.timer ??= setTimeout(() => { this.timer = null; this.flush(); }, wait);
  }

  private flush(now = Date.now()): void {
    const s = this.pending; this.pending = null;
    if (!s || !this.client) return;
    this.lastSent = now;
    try { this.client.broadcastStateUpdate({ bytes: encodeCanvas(s) }); } catch { /* the next change tries again */ }
  }

  close(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; this.client = null; this.onState = null; }
}
