#!/usr/bin/env node
// Screenshots every screen of the running app, phone (390×844) and desktop (1440×900), light
// and dark, into tests/screenshots/<theme>-<device>/<name>.png — for comparison against
// tests/design-refs (npm run refs). Needs the app at BASE (default http://localhost:5173).
//
//   node scripts/app-shots.mjs [outDir]
//   BASE=http://localhost:4173 PW_CHROMIUM=/opt/pw-browsers/chromium node scripts/app-shots.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] || path.join(root, 'tests', 'screenshots'));
const BASE = process.env.BASE || 'http://localhost:5173';
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

const ROUTES = [
  ['home', '#/practice'], ['settings', '#/practice/settings'], ['onboarding-1', '#/practice/setup'],
  ['library-lps', '#/library/lps'], ['library-stories', '#/library/stories'], ['library-questions', '#/library/questions'], ['library-files', '#/library/files'],
  ['lp-detail', '#/library/lps/deep'], ['story-editor', '#/library/stories/payments'], ['grid', '#/library/stories/grid'], ['file-preview', '#/library/files/f3'],
  ['history', '#/history'], ['session-detail', '#/history/s14'], ['progress', '#/progress'],
];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const report = [];

async function shoot(page, dir, name) {
  const file = path.join(dir, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  report.push(path.relative(outDir, file));
}

async function settle(page) {
  await page.waitForSelector('.splash', { state: 'detached', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

for (const theme of ['light', 'dark']) {
  for (const [device, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
    const dir = path.join(outDir, theme + '-' + device);
    fs.mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({ ...(device === 'phone' ? devices['iPhone 14'] : {}), viewport, deviceScaleFactor: 1, colorScheme: theme });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.push(`ERROR ${theme}-${device}: ${e.message}`));
    await page.goto(BASE + '/?repo=sample#/practice');
    await settle(page);
    // theme pref + onboarded flag through the app's own storage
    await page.evaluate((t) => { try { localStorage.setItem('mock.prefs.v1', JSON.stringify({ theme: t, voiceVisual: 'orb', liveLayout: 'stage', lastTab: 'practice' })); } catch {} }, theme);
    await page.reload(); await settle(page);

    for (const [name, hash] of ROUTES) {
      if (ONLY && !ONLY.test(name)) continue;
      try { await page.goto(BASE + '/?repo=sample' + hash); await settle(page); await shoot(page, dir, name); } catch (e) { report.push(`FAIL ${theme}-${device}/${name}: ${String(e).slice(0, 120)}`); }
    }
    // Sheets on the home screen
    const trySheet = async (name, open) => {
      if (ONLY && !ONLY.test(name)) return;
      try { await page.goto(BASE + '/?repo=sample#/practice'); await page.reload(); await settle(page); await open(); await page.waitForTimeout(600); await shoot(page, dir, name); await page.keyboard.press('Escape').catch(() => {}); } catch (e) { report.push(`FAIL ${theme}-${device}/${name}: ${String(e).slice(0, 120)}`); }
    };
    await trySheet('sheet-setup', () => page.getByRole('button', { name: /^Change$/ }).first().click());
    await trySheet('sheet-answer', async () => { await page.goto(BASE + '/?repo=sample#/library/questions'); await settle(page); await page.getByRole('button', { name: /Model answer/ }).first().click(); });
    await trySheet('sheet-add-question', async () => { await page.goto(BASE + '/?repo=sample#/library/questions'); await settle(page); await page.getByRole('button', { name: /^\+ (Add|Question)$/ }).first().click(); });

    // First-run steps 2 and 3
    if (!ONLY || ONLY.test('onboarding')) {
      try {
        await page.goto(BASE + '/?repo=sample#/practice/setup'); await settle(page);
        await page.getByRole('button', { name: /Skip — start with the LPs/ }).click(); await page.waitForTimeout(400); await shoot(page, dir, 'onboarding-2');
        await page.getByRole('button', { name: /^Next$/ }).click(); await page.waitForTimeout(400); await shoot(page, dir, 'onboarding-3');
      } catch (e) { report.push(`FAIL ${theme}-${device}/onboarding: ${String(e).slice(0, 120)}`); }
    }

    // The live session: start the suggested drill and capture states as the demo plays.
    if (!ONLY || ONLY.test('live')) {
      try {
        await page.goto(BASE + '/?repo=sample#/practice'); await page.reload(); await settle(page);
        await page.getByRole('button', { name: /^Start$/ }).first().click();
        const t0 = Date.now();
        const want = ['connecting', 'interviewer', 'answering', 'thinking', 'coaching', 'end'];
        const got = new Set();
        while (Date.now() - t0 < 150_000 && got.size < want.length) {
          const st = await page.locator('.live').getAttribute('data-phase').catch(() => null);
          const paused = await page.locator('.live').getAttribute('data-paused').catch(() => null);
          if (st && !got.has(st) && want.includes(st) && paused !== 'true') { got.add(st); await page.waitForTimeout(st === 'coaching' ? 2500 : 300); await shoot(page, dir, 'live-' + (st === 'end' ? 'ended' : st)); }
          if (st === 'coaching' && got.has('coaching') && !got.has('paused')) { got.add('paused'); await page.keyboard.press('Space').catch(() => {}); await page.waitForTimeout(400); await shoot(page, dir, 'live-paused'); await page.keyboard.press('Space').catch(() => {}); }
          if (st === 'end') break;
          await page.waitForTimeout(250);
        }
        if (!got.has('end')) { await page.getByRole('button', { name: /^End/ }).first().click().catch(() => {}); await page.waitForTimeout(1500); await shoot(page, dir, 'live-ended'); }
      } catch (e) { report.push(`FAIL ${theme}-${device}/live: ${String(e).slice(0, 160)}`); }
    }
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(outDir, 'report.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
