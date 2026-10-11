// Mock Meet bridge — the bot: a Chromium that opens the meeting, joins as "Mock · Interviewer"
// with the in-page bridge installed, reports where it is, and carries audio both ways.

import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { installMeetBridge } from './inpage.ts';
import { joinStep, leaveButton, pageState } from './meet-page.ts';
import type { BotStatus, Tile } from '../src/meet/protocol.ts';

export interface BotOptions {
  url: string;
  name: string;
  onStatus: (status: BotStatus, message?: string) => void;
  onPcm: (base64: string) => void;
  headless?: boolean;
  /** A Chrome/Chromium binary; else Playwright's. */
  executablePath?: string;
  /** 'chrome' to use the installed Google Chrome. */
  channel?: string;
  /** A profile directory: a bot signed in to a Google account joins without knocking in Workspace domains. */
  profileDir?: string;
  joinTimeoutMs?: number;
}

/** What the server needs from a bot (tests pass a fake). */
export interface BotLike {
  start(): Promise<void>;
  play(base64: string, rate: number): void;
  flush(): void;
  tile(t: Tile): void;
  leave(): Promise<void>;
}

const ARGS = [
  '--use-fake-ui-for-media-stream',          // grant mic/camera without a prompt
  '--use-fake-device-for-media-stream',      // devices exist; the in-page bridge replaces their streams
  '--autoplay-policy=no-user-gesture-required',
  '--disable-blink-features=AutomationControlled',
];

export class MeetBot implements BotLike {
  private o: BotOptions;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private status: BotStatus = 'idle';
  private watch: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(o: BotOptions) { this.o = o; }

  private set(status: BotStatus, message?: string): void {
    if (status === this.status && !message) return;
    this.status = status;
    this.o.onStatus(status, message);
  }

  async start(): Promise<void> {
    this.set('launching');
    const headless = this.o.headless ?? true;
    const launch = { headless, args: ARGS, executablePath: this.o.executablePath, channel: this.o.channel };
    if (this.o.profileDir) {
      this.context = await chromium.launchPersistentContext(this.o.profileDir, { ...launch, viewport: { width: 1280, height: 800 } });
    } else {
      this.browser = await chromium.launch(launch);
      // Headless Chromium says so in its user agent, and Meet turns it away.
      const ua = (await this.browser.newPage().then(async (p) => { const v = await p.evaluate(() => navigator.userAgent); await p.close(); return v; })).replace('HeadlessChrome', 'Chrome');
      this.context = await this.browser.newContext({ userAgent: ua, viewport: { width: 1280, height: 800 } });
    }
    const origin = new URL(this.o.url).origin;
    await this.context.grantPermissions(['microphone', 'camera'], { origin }).catch(() => undefined);
    await this.context.exposeBinding('__mockBridgeEmit', (_src, m: { type?: string; data?: string }) => {
      if (m && m.type === 'pcm' && typeof m.data === 'string' && this.status === 'in_call') this.o.onPcm(m.data);
    });
    await this.context.addInitScript(installMeetBridge);
    const page = this.context.pages()[0] ?? await this.context.newPage();
    this.page = page;
    page.on('close', () => { if (!this.stopped) this.set('left', 'The bot’s browser closed'); });
    this.set('joining');
    await page.goto(this.o.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await this.join(page);
  }

  private async join(page: Page): Promise<void> {
    const deadline = Date.now() + (this.o.joinTimeoutMs ?? 10 * 60_000);
    let pressed = false;
    while (!this.stopped && Date.now() < deadline) {
      const { state, text } = await pageState(page);
      if (state === 'in_call') { this.set('in_call'); this.monitor(page); return; }
      if (state === 'denied') { this.set('error', text); return; }
      if (state === 'waiting') this.set('waiting');
      else if (state === 'join_screen' && !pressed) {
        pressed = await joinStep(page, this.o.name).catch(() => false);
        if (pressed) this.set('joining', 'Asked to join');
      } else if (state === 'join_screen' && pressed) {
        // Back on the join screen after pressing: the request lapsed or was declined; try again.
        pressed = await joinStep(page, this.o.name).catch(() => false);
      }
      await page.waitForTimeout(500);
    }
    if (!this.stopped) this.set('error', 'Nobody let Mock in');
  }

  /** In the call: notice being removed or the call ending. */
  private monitor(page: Page): void {
    this.watch = setInterval(() => {
      void pageState(page).then(({ state, text }) => {
        if (this.stopped || this.status !== 'in_call') return;
        if (state === 'denied') this.set('left', text);
        else if (state !== 'in_call' && state !== 'loading') this.set('left', 'Mock is no longer in the call');
      }).catch(() => undefined);
    }, 2000);
  }

  /** Page calls in order, never blocking the caller; dropped once the page is gone. */
  private run(job: (p: Page) => Promise<unknown>): void {
    const p = this.page;
    if (!p || this.stopped) return;
    this.queue = this.queue.then(() => job(p)).catch(() => undefined);
  }

  play(base64: string, rate: number): void { this.run((p) => p.evaluate(([d, r]) => (window as any).__mockBridge?.play(d, r), [base64, rate] as const)); }
  flush(): void { this.run((p) => p.evaluate(() => (window as any).__mockBridge?.flush())); }
  tile(t: Tile): void { this.run((p) => p.evaluate((x) => (window as any).__mockBridge?.tile(x), t)); }

  async leave(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.watch) { clearInterval(this.watch); this.watch = null; }
    const page = this.page;
    if (page && this.status === 'in_call') await leaveButton(page).first().click({ timeout: 3000 }).catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null; this.context = null; this.browser = null;
    this.set('left');
  }
}
