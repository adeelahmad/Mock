# Mock

A personal voice app for rehearsing an AWS interview loop. A live interviewer (Gemini Live)
asks Leadership Principle questions and probes with follow-ups; between answers a coach says,
out loud, what to fix — judged against your own stories, numbers and notes. Every session is
recorded, every answer gets an analysis card, every session a report, and progress builds
across sessions. Local-first: everything stays in the browser; backups move data between phone
and laptop.

Built to the Claude Design project in `design/` (the design is the spec). See
`docs/plan.md` for the architecture and milestones, `docs/design-inventory.md` for the feature
checklist, and **`docs/STATUS.md` for where the work currently stands**.

## Run

```
npm install
npm run dev
```

`npm run typecheck`, `npm test`, `npm run build`, `npm run e2e` (Playwright, simulated transport).

## Stack

React 19 · TypeScript · Vite · DuckDB-Wasm + IndexedDB · Gemini Live (M3). No backend.
