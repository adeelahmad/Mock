import { test, expect, type Page } from '@playwright/test';
import { open, waitForPhase } from './helpers.ts';

// A session on the turn-by-turn pipeline: Chrome speech in and out, an OpenAI-compatible model.
// Chrome's engines are replaced by stand-ins (headless Chromium has no recogniser), the mic is
// Chromium's fake device, and the "Ollama" endpoint is answered by page.route.
test.use({
  permissions: ['microphone'],
  launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

const CHROME_SPEECH = () => {
  const w = window as any;
  w.__spoken = [] as string[];
  class FakeRecognition {
    continuous = false; interimResults = false; lang = '';
    onresult: any = null; onerror: any = null; onend: any = null;
    start() { w.__rec = this; }
    stop() { this.onend?.(); }
    abort() { if (w.__rec === this) w.__rec = null; setTimeout(() => this.onend?.(), 0); }
  }
  w.SpeechRecognition = FakeRecognition; w.webkitSpeechRecognition = FakeRecognition;
  w.__say = (text: string) => { const r = w.__rec; if (!r) return false; const res = Object.assign([{ transcript: text }], { isFinal: true }); r.onresult?.({ resultIndex: 0, results: [res] }); return true; };
  w.SpeechSynthesisUtterance = class { text: string; onend: any = null; onerror: any = null; onstart: any = null; rate = 1; lang = ''; voice = null; constructor(t: string) { this.text = t; } };
  const synth = { getVoices: () => [], speak: (u: any) => { w.__spoken.push(u.text); setTimeout(() => u.onend?.(), 30); }, cancel: () => {}, addEventListener: () => {} };
  Object.defineProperty(w, 'speechSynthesis', { value: synth, configurable: true });
};

const Q = 'Tell me about a time you found a problem nobody else had noticed.';

async function fakeModel(page: Page): Promise<any[]> {
  const bodies: any[] = [];
  await page.route('http://llm.test/v1/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    bodies.push(body);
    const last = body.messages[body.messages.length - 1];
    const msg = last.content === '[START]'
      ? { content: 'Session fifteen. ' + Q, tool_calls: [{ id: 'q1', type: 'function', function: { name: 'new_question', arguments: JSON.stringify({ interviewer: 'Dana Whitfield', question: Q, lp: 'Dive Deep' }) } }] }
      : last.content === '[END]'
        ? { content: 'That is the session. Next time, lead with the number.' }
        : last.content === 'Say hello.'
          ? { content: 'Hello there.' }
          : last.role === 'user' && !String(last.content).startsWith('[')
            ? { content: 'Pausing the interview. Good depth and a clear number. Say I, not we. Inclined. Back to the interview.' }
            : { content: 'OK.' };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: msg }], usage: { prompt_tokens: 100, completion_tokens: 20 } }) });
  });
  return bodies;
}

test.describe('pluggable voice and model', () => {
  test.setTimeout(120_000);

  test('Settings picks Chrome speech and an OpenAI-compatible model; a session runs on them', async ({ page }) => {
    await page.addInitScript(CHROME_SPEECH);
    const bodies = await fakeModel(page);
    await open(page, '#/practice/settings');
    await page.getByRole('combobox', { name: /^Speech to text/ }).selectOption('browser');
    await page.getByRole('combobox', { name: /^Language model/ }).selectOption('openai');
    await page.getByRole('combobox', { name: /^Text to speech/ }).selectOption('browser');
    await expect(page.getByText(/Now: Chrome → llama3\.2 → Chrome/)).toBeVisible();
    const base = page.getByLabel('Base URL');
    await base.fill('http://llm.test/v1');
    await base.press('Enter');
    await page.getByRole('button', { name: 'Test · say hello' }).last().click();
    await expect(page.getByText(/“Hello there\.” · 120 tokens/)).toBeVisible();

    await open(page, '#/practice');
    await page.getByRole('button', { name: /^Start$/ }).click();
    await expect(page).toHaveURL(/#\/live$/);
    await expect(page.getByText(/Demo · add a Gemini key/)).toHaveCount(0);
    await expect(page.getByText(Q).first()).toBeVisible({ timeout: 20_000 });
    const first = bodies.find((b) => b.messages.some((m: any) => m.content === '[START]'));
    expect(first.model).toBe('llama3.2');
    expect(first.tools.map((t: any) => t.function.name)).toContain('new_question');
    expect(await page.evaluate(() => (window as any).__spoken.join(' '))).toContain(Q);

    // The candidate answers through the (stand-in) recogniser; the pause ends the turn.
    await expect.poll(() => page.evaluate(() => (window as any).__say('I traced the latency to a cache stampede and cut p99 by 40 percent.')), { timeout: 15_000 }).toBe(true);
    await waitForPhase(page, 'coaching', 30_000);
    await expect.poll(() => page.evaluate(() => (window as any).__spoken.join(' '))).toContain('Back to the interview');

    await page.getByRole('button', { name: /^End/ }).first().click();
    await waitForPhase(page, ['ended', 'end'], 30_000);
    expect(bodies.some((b) => b.messages[b.messages.length - 1].content === '[END]')).toBe(true);
  });

  test('the setup sheet picks the stack for one session without changing Settings', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Change' }).first().click();
    await page.getByRole('button', { name: /More · remembered/ }).click();
    const sheet = page.locator('.more-box');
    await expect(sheet.getByText(/Chrome → Gemini → Chrome/).first()).toBeVisible();
    await sheet.getByRole('combobox', { name: /^Text to speech/ }).selectOption('elevenlabs');
    await expect(sheet.getByText(/Chrome → Gemini → ElevenLabs/)).toBeVisible();
    await open(page, '#/practice/settings');
    await expect(page.getByRole('combobox', { name: /^Speech to text/ })).toHaveValue('browser');
    await expect(page.getByRole('combobox', { name: /^Text to speech/ })).toHaveValue('browser');
  });
});
