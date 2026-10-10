#!/usr/bin/env node
// Renders every artboard of the Claude Design boards in design/ to PNGs, light and dark,
// so the app's screenshots can be compared against the design.
//
//   node scripts/design-refs.mjs [outDir]      (default tests/design-refs)
//   PW_CHROMIUM=/path/to/chrome node scripts/design-refs.mjs
//
// The boards load React and Babel from unpkg and fonts from Google Fonts, so this needs
// network access. Output is git-ignored; regenerate when the design changes.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const designDir = path.join(root, 'design');
const outDir = path.resolve(process.argv[2] || path.join(root, 'tests', 'design-refs'));
const BOARDS = [
  ['Mock - Foundations.dc.html', 'foundations'], ['Mock - Practice.dc.html', 'practice'], ['Mock - Live Session.dc.html', 'live'],
  ['Mock - Library.dc.html', 'library'], ['Mock - History & Progress.dc.html', 'history'], ['Mock - Settings & Onboarding.dc.html', 'settings'],
  ['Mock App.dc.html', 'app'], ['LiveScreen.dc.html', 'livescreen'], ['AnalysisCard.dc.html', 'analysiscard'],
];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jsx': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown', '.webp': 'image/webp' };

const server = http.createServer((req, res) => {
  const p = path.join(designDir, decodeURIComponent((req.url || '/').split('?')[0]));
  if (!p.startsWith(designDir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('Content-Type', MIME[path.extname(p)] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const index = [];
for (const [file, name] of BOARDS) {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(file)}`, { waitUntil: 'load', timeout: 90_000 });
    await page.waitForTimeout(9000);
    if (theme === 'dark') {
      await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); document.querySelectorAll('[data-theme]').forEach((e) => e.setAttribute('data-theme', 'dark')); });
      await page.waitForTimeout(800);
    }
    const dir = path.join(outDir, name + (theme === 'dark' ? '-dark' : ''));
    fs.mkdirSync(dir, { recursive: true });
    const els = page.locator('[data-screen-label]');
    const n = await els.count();
    const seen = {};
    for (let i = 0; i < n; i++) {
      const el = els.nth(i);
      let label = ((await el.getAttribute('data-screen-label')) || 'board-' + i).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'board';
      if (seen[label]) label += '-' + (++seen[label]); else seen[label] = 1;
      try { await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: path.join(dir, label + '.png'), timeout: 20_000 }); index.push(path.relative(outDir, path.join(dir, label + '.png'))); }
      catch (e) { console.error('skip', dir, label, String(e).slice(0, 80)); }
    }
    if (n === 0) { await page.screenshot({ path: path.join(dir, 'full.png'), fullPage: true }); index.push(path.relative(outDir, path.join(dir, 'full.png'))); }
    await page.close();
    console.log(name, theme, n);
  }
}
fs.writeFileSync(path.join(outDir, 'index.txt'), index.join('\n') + '\n');
await browser.close();
server.close();
console.log('wrote', index.length, 'references to', outDir);
