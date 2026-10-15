import { test, expect, type Page } from '@playwright/test';
import { open } from './helpers.ts';

// The prep canvas: pick the area, answer out loud, see each phrase marked; whiteboard and chat.
// Chrome's recogniser is a stand-in (headless Chromium has none); with no key the offline judge
// marks phrases, and an OpenAI-compatible "model" answered by page.route plays the AI.
test.use({
  permissions: ['microphone'],
  launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

const CHROME_SPEECH = () => {
  const w = window as any;
  class FakeRecognition {
    continuous = false; interimResults = false; lang = '';
    onresult: any = null; onerror: any = null; onend: any = null;
    start() { w.__rec = this; }
    stop() { this.onend?.(); }
    abort() { if (w.__rec === this) w.__rec = null; setTimeout(() => this.onend?.(), 0); }
  }
  w.SpeechRecognition = FakeRecognition; w.webkitSpeechRecognition = FakeRecognition;
  w.__say = (text: string, final = true) => { const r = w.__rec; if (!r) return false; const res = Object.assign([{ transcript: text }], { isFinal: final }); r.onresult?.({ resultIndex: 0, results: [res] }); return true; };
};

const say = async (page: Page, text: string, final = true) => {
  await expect.poll(() => page.evaluate(([t, f]) => (window as any).__say(t, f), [text, final] as const), { timeout: 10_000 }).toBe(true);
};

/** Clicks areas until the right one opens the answer. */
async function pickRightArea(page: Page): Promise<number> {
  const areas = page.getByRole('group', { name: 'Areas' }).getByRole('button');
  const n = await areas.count();
  for (let i = 0; i < n; i++) {
    const b = areas.nth(i);
    if (await b.isDisabled()) continue;
    await b.click();
    if (await page.getByRole('region', { name: 'Your answer' }).isVisible()) return i;
    await expect(b).toBeDisabled();
  }
  throw new Error('no area opened the answer');
}

test.describe('prep canvas', () => {
  test.setTimeout(90_000);

  test('pick the area, answer out loud: each phrase is marked; whiteboard and chat work offline', async ({ page }) => {
    await page.addInitScript(CHROME_SPEECH);
    await open(page, '#/practice');
    await page.getByRole('button', { name: 'Open the canvas' }).click();
    await expect(page).toHaveURL(/#\/canvas$/);
    await expect(page.getByText('Question 1')).toBeVisible();

    const misses = await pickRightArea(page);
    if (misses > 0) await expect(page.locator('.cv-msg.ai').filter({ hasText: /^Not / }).first()).toBeVisible();
    await expect(page.locator('.cv-msg.ai').filter({ hasText: /^Yes, / })).toBeVisible();

    await page.getByRole('button', { name: 'Listen' }).click();
    await expect(page.getByRole('button', { name: 'Listening' })).toBeVisible();
    await expect(page.locator('.cv-rec')).toBeVisible();
    // Live captions while the words come in.
    await say(page, 'I traced the outage', false);
    await expect(page.locator('.cv-ph.live')).toHaveText('I traced the outage');
    await say(page, 'I traced the outage and cut p99 by 40 percent.');
    const words = page.getByTestId('cv-words');
    await expect(words.locator('[data-mark="match"]')).toHaveText(/cut p99 by 40 percent/);
    await say(page, 'We usually follow best practice in general.');
    await expect(words.locator('[data-mark="drift"]')).toHaveCount(1);
    await say(page, "Honestly I don't know.");
    await expect(words.locator('[data-mark="redo"]')).toHaveCount(1);
    await expect(page.locator('.cv-legend')).toHaveText(/on track 1.*drifting 1.*redo 1/);

    await page.getByRole('button', { name: 'Finish answer' }).click();
    await expect(page.locator('.cv-msg.ai').last()).toHaveText(/1 on track, 1 drifting, 1 to redo/);

    // Talking outside an answer goes to the chat; typing too.
    await say(page, 'Can you give me a STAR outline?');
    await expect(page.locator('.cv-msg.me').filter({ hasText: 'Can you give me a STAR outline?' })).toBeVisible();
    await expect(page.locator('.cv-msg.ai').last()).toHaveText(/Situation in one line/);
    await page.getByRole('textbox', { name: 'Message the AI' }).fill('What next?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.cv-msg.me').last()).toHaveText('What next?');

    // Whiteboard: a sticky note, a pen stroke, a template and a timer.
    const board = page.getByRole('img', { name: 'Whiteboard drawing' });
    await board.scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Sticky note' }).click();
    let box = (await board.boundingBox())!;
    await page.mouse.click(box.x + 120, box.y + 80);
    await expect(page.getByTestId('wb-note')).toHaveCount(1);
    await page.getByRole('textbox', { name: 'Note' }).fill('Lead with the number');
    await page.getByRole('button', { name: 'Pen', exact: true }).click();
    box = (await board.boundingBox())!;
    await page.mouse.move(box.x + 300, box.y + box.height - 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 360, box.y + box.height - 60, { steps: 6 });
    await page.mouse.move(box.x + 420, box.y + box.height - 30, { steps: 6 });
    await page.mouse.up();
    await expect(board.locator('path.wb-ink')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo board change' }).click();
    await expect(board.locator('path.wb-ink')).toHaveCount(0);
    await page.getByRole('button', { name: 'Redo board change' }).click();
    await expect(board.locator('path.wb-ink')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo board change' }).click();
    await page.getByRole('button', { name: 'Templates' }).click();
    await page.getByRole('menuitem', { name: 'STAR answer' }).click();
    await expect(board.locator('rect.wb-shape')).toHaveCount(4);
    await page.getByRole('button', { name: 'Undo board change' }).click();
    await expect(board.locator('rect.wb-shape')).toHaveCount(0);
    await page.getByRole('button', { name: 'Timer' }).click();
    await page.getByRole('menuitem', { name: '2 min for everyone' }).click();
    await expect(page.getByRole('timer')).toHaveText(/^[12]:\d\d$/);

    // N: the next question, from the keyboard.
    await page.keyboard.press('n');
    await expect(page.getByText('Question 2')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Areas' })).toBeVisible();
    await expect(page.getByTestId('wb-note')).toHaveCount(1);

    // Stop saves the sitting to History, with its recording.
    await page.getByRole('button', { name: 'Stop & save' }).click();
    const saved = page.locator('.cv-saved');
    await expect(saved).toContainText(/Session \d+ saved · 1 answer · recording/);
    await saved.getByRole('button', { name: 'Open in History' }).click();
    await expect(page).toHaveURL(/#\/history\//);
    await expect(page.getByText('Canvas').first()).toBeVisible();
    await expect(page.getByText('I traced the outage and cut p99 by 40 percent.').first()).toBeVisible();
  });

  test('with a model: the AI marks phrases and writes on the whiteboard', async ({ page }) => {
    await page.addInitScript(CHROME_SPEECH);
    const asked: any[] = [];
    await page.route('http://llm.test/v1/chat/completions', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      asked.push(body);
      const system = String(body.messages[0]?.content ?? '');
      const last = body.messages[body.messages.length - 1];
      const msg = /Reply with JSON only/.test(system)
        ? { content: JSON.stringify(/\bwe\b/i.test(String(last.content).split('Newest phrase:')[1] ?? '') ? { mark: 'drift', note: 'Say I, not we.' } : { mark: 'match', note: 'Strong opening.' }) }
        : last.role === 'tool'
          ? { content: 'Put an outline on the board.' }
          : { content: '', tool_calls: [{ id: 'n1', type: 'function', function: { name: 'add_note', arguments: JSON.stringify({ text: 'S · T · A · R: lead with the 40% number' }) } }] };
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: msg }], usage: { prompt_tokens: 50, completion_tokens: 10 } }) });
    });
    await open(page, '#/practice/settings');
    await page.getByRole('combobox', { name: /^Speech to text/ }).selectOption('browser');
    await page.getByRole('combobox', { name: /^Language model/ }).selectOption('openai');
    const base = page.getByLabel('Base URL');
    await base.fill('http://llm.test/v1');
    await base.press('Enter');
    await expect(page.getByText(/Now: Chrome → llama3\.2/)).toBeVisible();

    await open(page, '#/canvas');
    await expect(page.getByText(/hears you · type or talk/)).toBeVisible();
    await pickRightArea(page);
    await page.getByRole('button', { name: 'Listen' }).click();
    await say(page, 'I owned the rollout end to end.');
    const words = page.getByTestId('cv-words');
    await expect(words.locator('[data-mark="match"]')).toHaveAttribute('title', /Strong opening/);
    await say(page, 'Then we shipped it.');
    await expect(words.locator('[data-mark="drift"]')).toHaveAttribute('title', /Say I, not we/);
    expect(asked.some((b) => /Answer so far: I owned the rollout end to end\./.test(b.messages[1]?.content ?? ''))).toBe(true);

    await page.getByRole('textbox', { name: 'Message the AI' }).fill('Outline it for me');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.cv-msg.ai').last()).toHaveText('Put an outline on the board.');
    await expect(page.locator('.wb-note.ai')).toHaveText(/S · T · A · R: lead with the 40% number/);
  });
});
