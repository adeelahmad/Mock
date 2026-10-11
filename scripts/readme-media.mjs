#!/usr/bin/env node
// README and launch media: a few desktop screenshots (light and dark) and a short demo GIF of a
// live session on the built-in demo transport, into docs/media/. Needs the app at BASE (default
// http://localhost:5173) and ffmpeg on PATH for the GIF.
//
//   node scripts/readme-media.mjs
//   BASE=http://localhost:8787 PW_CHROMIUM=/opt/pw-browsers/chromium node scripts/readme-media.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'media');
const BASE = process.env.BASE || 'http://localhost:5173';
const viewport = { width: 1280, height: 800 };
fs.mkdirSync(outDir, { recursive: true });

const SHOTS = [['practice', '#/practice'], ['session', '#/history/s14'], ['progress', '#/progress'], ['library', '#/library/stories']];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });

async function settle(page) {
  await page.waitForSelector('.splash', { state: 'detached', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function open(ctx, theme) {
  const page = await ctx.newPage();
  await page.goto(BASE + '/?repo=sample#/practice');
  await settle(page);
  await page.evaluate((t) => { try { localStorage.setItem('mock.prefs.v1', JSON.stringify({ theme: t, voiceVisual: 'orb', liveLayout: 'stage', lastTab: 'practice' })); } catch {} }, theme);
  await page.reload(); await settle(page);
  return page;
}

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: theme });
  const page = await open(ctx, theme);
  for (const [name, hash] of SHOTS) {
    await page.goto(BASE + '/?repo=sample' + hash); await settle(page);
    await page.screenshot({ path: path.join(outDir, `${name}-${theme}.png`) });
  }
  // The live session mid-coaching: the screen people most want to see.
  await page.goto(BASE + '/?repo=sample#/practice'); await page.reload(); await settle(page);
  await page.getByRole('button', { name: /^Start$/ }).first().click();
  await page.waitForSelector('.live[data-phase="coaching"]', { timeout: 120_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, `live-${theme}.png`) });
  await ctx.close();
}

// Demo GIF: screenshot frames of a live drill (dark) on the demo transport, then a
// palette-optimised GIF with ffmpeg. Frames instead of Playwright video: no extra download.
const frameDir = fs.mkdtempSync(path.join(outDir, '.frames-'));
const ctx = await browser.newContext({ viewport, colorScheme: 'dark' });
const page = await open(ctx, 'dark');
await page.getByRole('button', { name: /^Start$/ }).first().click();
const t0 = Date.now();
let n = 0;
while (Date.now() - t0 < 50_000) { // connect → question → answer → coaching
  await page.screenshot({ path: path.join(frameDir, `f${String(n++).padStart(4, '0')}.png`) });
  const phase = await page.locator('.live').getAttribute('data-phase').catch(() => null);
  if (phase === 'end') break;
}
const fps = (n / ((Date.now() - t0) / 1000)) * 1.6; // played back at 1.6× speed
await ctx.close();
await browser.close();

const gif = path.join(outDir, 'demo.gif');
const filters = 'scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', fps.toFixed(2), '-i', path.join(frameDir, 'f%04d.png'), '-vf', filters, gif]);
fs.rmSync(frameDir, { recursive: true, force: true });
console.log(`${n} frames, GIF at ${fps.toFixed(1)} fps`);
console.log(fs.readdirSync(outDir).map((f) => `${f}  ${(fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0)} KB`).join('\n'));
