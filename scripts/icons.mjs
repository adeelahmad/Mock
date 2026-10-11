// Renders the PWA icons in public/icons from SVG sources with the installed Chromium.
// Run after changing an icon: `npm run icons`. The PNGs are committed (the build does not render).
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url));
const glyph = (inner) => `<g fill="none" stroke="#202124" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
const mic = glyph('<rect x="221" y="162" width="70" height="122" rx="35" fill="#202124"/><path d="M188 250a68 68 0 0 0 136 0"/><path d="M256 318v32"/>');
// Maskable: full-bleed background, the mark inside the 80 % safe zone.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#202124"/><g transform="translate(256 256) scale(.78) translate(-256 -256)"><circle cx="256" cy="256" r="150" fill="#F9AB00"/>${mic}</g></svg>`;
// Apple touch icon: iOS rounds the corners itself, so no transparent corners.
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#202124"/><circle cx="256" cy="256" r="165" fill="#F9AB00"/>${mic}</svg>`;
const shortcut = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#F9AB00"/>${inner}</svg>`;
const start = shortcut('<polygon points="200 140 380 256 200 372" fill="#202124" stroke="#202124" stroke-width="24" stroke-linejoin="round"/>');
const last = shortcut(glyph('<circle cx="256" cy="256" r="130" stroke-width="28"/><path d="M256 180v80l52 32" stroke-width="28"/>'));
const any = readFileSync(dir + 'icon.svg', 'utf8');

const jobs = [
  ['icon-192.png', any, 192], ['icon-512.png', any, 512],
  ['maskable-512.png', maskable, 512], ['apple-touch-icon.png', apple, 180],
  ['shortcut-start.png', start, 96], ['shortcut-last.png', last, 96],
];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage();
for (const [name, svg, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  writeFileSync(dir + name, await page.screenshot({ omitBackground: true }));
  console.log('wrote', name);
}
await browser.close();
