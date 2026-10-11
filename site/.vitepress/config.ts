// Mock — the docs and landing site (VitePress). Published to GitHub Pages with the app beside it:
// the site at the Pages root, the static app build at /app/ (.github/workflows/pages.yml).
// DOCS_BASE is the Pages sub-path; it defaults to the project page, /Mock/.

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';
import { CSV_TEMPLATES } from '../../src/domain/csv-templates.ts';

const base = process.env.DOCS_BASE ?? '/Mock/';

// The sample CSVs come from the same source the app's import flows offer, so they never drift.
// site/public is generated (gitignored): the samples and the app icon.
const pub = fileURLToPath(new URL('../public/', import.meta.url));
mkdirSync(pub + 'samples', { recursive: true });
for (const t of Object.values(CSV_TEMPLATES)) writeFileSync(pub + 'samples/' + t.file, t.text);
copyFileSync(fileURLToPath(new URL('../../public/icons/icon.svg', import.meta.url)), pub + 'logo.svg');

export default defineConfig({
  base,
  title: 'Mock',
  description: 'Rehearse an interview loop with a live voice interviewer and a coach who judges you against your own prep.',
  lang: 'en',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: base + 'logo.svg' }],
    ['meta', { name: 'theme-color', content: '#ffffff' }],
  ],
  // The app is a separate build copied into /app/ at deploy time, so VitePress can't see it.
  ignoreDeadLinks: [/^\/app\/?/, /^\/samples\//],
  themeConfig: {
    logo: '/logo.svg',
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
          { text: 'Sign-in and sync', link: '/guide/sync' },
          { text: 'Google Meet interviewer', link: '/guide/meet' },
        ],
      },
      {
        text: 'Run it',
        items: [
          { text: 'Develop (Makefile)', link: '/run/develop' },
          { text: 'Deploy', link: '/run/deploy' },
          { text: 'Proxmox VE', link: '/run/proxmox' },
          { text: 'Go binary', link: '/run/go-binary' },
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
