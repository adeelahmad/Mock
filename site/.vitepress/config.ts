// Mock — the docs and landing site (VitePress). Published to GitHub Pages with the app beside it:
// the site at the Pages root, the static app build at /app/ (.github/workflows/pages.yml).
// DOCS_BASE is the Pages sub-path; it defaults to the project page, /Mock/.

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';
import { CSV_TEMPLATES } from '../../src/domain/csv-templates.ts';

const base = process.env.DOCS_BASE ?? '/Mock/';

// The sample CSVs come from the same source the app's import flows offer, so they never drift.
// site/public is generated (gitignored): the samples and the brand assets, copied from the app's
// public/ so the docs and the app never drift (brand kit v1.0, robot identity).
const pub = fileURLToPath(new URL('../public/', import.meta.url));
const app = (f: string) => fileURLToPath(new URL('../../public/' + f, import.meta.url));
mkdirSync(pub + 'samples', { recursive: true });
for (const t of Object.values(CSV_TEMPLATES)) writeFileSync(pub + 'samples/' + t.file, t.text);
for (const [from, to] of [
  ['icons/icon.svg', 'favicon.svg'], ['favicon.ico', 'favicon.ico'], ['icons/apple-touch-icon.png', 'apple-touch-icon.png'],
  ['icons/app-icon.svg', 'app-icon.svg'], ['brand/mock-logo.svg', 'mock-logo.svg'], ['brand/mock-logo-dark.svg', 'mock-logo-dark.svg'],
  ['brand/og.png', 'og.png'], ['brand/og-dark.png', 'og-dark.png'],
]) copyFileSync(app(from), pub + to);

// Pages serves the site at an absolute origin; social cards need an absolute image URL.
const origin = process.env.DOCS_ORIGIN ?? 'https://adeelahmad.github.io';
const card = 'Rehearse your interview loop. Practise. Get coached. Try again.';

export default defineConfig({
  base,
  title: 'Mock',
  description: 'Rehearse an interview loop with a live voice interviewer and a coach who judges you against your own prep.',
  lang: 'en',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', href: base + 'favicon.ico', sizes: '16x16 32x32 48x48' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: base + 'favicon.svg' }],
    ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: base + 'apple-touch-icon.png' }],
    ['meta', { name: 'theme-color', content: '#FFFFFF', media: '(prefers-color-scheme: light)' }],
    ['meta', { name: 'theme-color', content: '#18191B', media: '(prefers-color-scheme: dark)' }],
    ['meta', { property: 'og:title', content: 'Mock - Voice interview practice' }],
    ['meta', { property: 'og:description', content: card }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:image', content: origin + base + 'og.png' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'Mock - Voice interview practice' }],
    ['meta', { name: 'twitter:description', content: card }],
    ['meta', { name: 'twitter:image', content: origin + base + 'og.png' }],
  ],
  // The app is a separate build copied into /app/ at deploy time, so VitePress can't see it.
  ignoreDeadLinks: [/^\/app\/?/, /^\/samples\//],
  themeConfig: {
    logo: { light: '/mock-logo.svg', dark: '/mock-logo-dark.svg', alt: 'Mock' },
    siteTitle: false,
    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Run it', link: '/run/develop', activeMatch: '/run/' },
      { text: 'Open the app', link: '/app/', target: '_self' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Features', link: '/guide/features' },
          { text: 'Areas and CSV import', link: '/guide/areas-and-import' },
          { text: 'Spend tracker', link: '/guide/spend' },
          { text: 'Game', link: '/guide/game' },
          { text: 'Hints from your files', link: '/guide/hints' },
          { text: 'Sync with a passphrase', link: '/guide/passphrase-sync' },
          { text: 'Sign-in and sync', link: '/guide/sync' },
          { text: 'Google Meet interviewer', link: '/guide/meet' },
        ],
      },
      {
        text: 'Run it',
        items: [
          { text: 'Install (one binary)', link: '/run/install' },
          { text: 'Proxmox VE', link: '/run/proxmox' },
          { text: 'Deploy', link: '/run/deploy' },
          { text: 'Build from source', link: '/run/develop' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/adeelahmad/Mock' }],
    search: { provider: 'local' },
    editLink: { pattern: 'https://github.com/adeelahmad/Mock/edit/main/site/:path' },
    outline: { level: [2, 3] },
    footer: { message: 'Local-first. Your Gemini key stays on your device.' },
  },
});
