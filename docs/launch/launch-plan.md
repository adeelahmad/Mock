# Launch plan

Goal: GitHub Trending (daily, Go and TypeScript, and overall) in launch week. Trending ranks
stars gained in a short window, so the posts below go out together on one morning, and the
first few hours of replies matter most.

Nothing here has been posted. Every post is a draft for Adeel to edit and send; the personal
lines are placeholders for his own story, so make them true before posting.

## Before launch day

Work through the checklist in [`repo-setup.md`](repo-setup.md): public repo, About and topics,
social preview, Pages, `v0.1.0` released, Discussions on, a few `good first issue`s.

Then:

1. **Dry-run the first minute** on a clean machine and a phone: the install one-liner, `mock`,
   the demo drill with no key, then a real drill with a Gemini key. Anything that breaks here
   breaks for the first thousand visitors.
2. **Record a 60–90 s video** of a real Gemini Live drill with sound (the GIF has no audio, and
   the voice is the point). Upload it to the release notes and X.
3. Line up 3–5 people who'd honestly try it on the day and leave feedback (not upvote rings: HN
   and Reddit detect and penalise those).

## Launch day (Tuesday–Thursday)

| Time (US Eastern) | Where | What |
|---|---|---|
| 08:00–09:00 | Hacker News | Show HN post (below). Stay on the thread all morning. |
| 09:00 | X | Thread with the video (below). |
| 10:00 | Reddit | r/cscareerquestions (check the self-promotion rule; use the weekly thread if required), r/selfhosted, r/golang (binary angle) |
| 10:00 | Lobsters | `show` + `go` tags, only with an invite |
| afternoon | LinkedIn | The X thread as one post; interview prep does well there |
| next day | Product Hunt | Optional, with the same video |

## After

- Answer every issue and comment within a day for the first two weeks.
- Turn repeated questions into docs pages and repeated asks into `good first issue`s.
- Post a short "what changed since launch" update after two weeks (X, the HN thread is closed by
  then, Reddit only where it's welcome).

---

## Show HN

**Title** (≤80 chars):

> Show HN: Mock – rehearse interviews out loud with a live AI interviewer and coach

**URL:** `https://github.com/adeelahmad/Mock`

**First comment** (post it right after submitting):

> Hi HN, I built Mock to prepare for a loop of behavioral interviews. Reading my notes wasn't
> rehearsing: out loud it's easy to say "significant impact" when your notes say "$1.2M", and run
> out of time before the result.
>
> Mock is a voice app. A Gemini Live interviewer asks questions on the areas the loop assesses
> (I started with Amazon's Leadership Principles; you can import any set as CSV), follows up, and
> hears you out. After each answer a coach says out loud what to fix, judged against your own
> stories: the numbers you had and didn't say, your STAR time split, "I" vs "we", pace and
> fillers. Sessions are recorded and get a report; the next drill leans on your weakest areas.
>
> It's local-first: the app is a PWA with DuckDB-Wasm on IndexedDB, your Gemini key stays in the
> browser, and the only server calls are to Google. If you want sync across devices, there's one
> Go binary (pure Go, SQLite embedded) that serves the app, does OAuth/OIDC sign-in and sync, and
> can join a Google Meet call as the interviewer, so a friend can sit in as a second interviewer.
>
> Install: `curl -fsSL https://raw.githubusercontent.com/adeelahmad/Mock/main/install.sh | sh`
> and run `mock`. Without a key it runs a full demo drill, so you can see it before spending
> anything. It counts every token and shows what you've spent.
>
> MIT licensed. I'd love feedback on the coaching: what feedback actually helped you in real
> interviews?

## Reddit

### r/cscareerquestions (or its weekly self-promo thread)

**Title:** I built a free, open-source voice mock interviewer that coaches you against your own STAR stories

> Reading notes isn't the same as answering out loud, so I built Mock for my own prep: you talk, a live AI interviewer (Gemini) asks and follows up, and after each answer a
> coach tells you what to fix, using your own stories. Things like "you had 41 minutes and $1.2M
> in your notes and said 'under an hour' and 'significant'", or "40% of your answer was setup,
> 15% result".
>
> - Bring your own stories and question lists (CSV/notes), or start from the Amazon Leadership
>   Principles set
> - Every session recorded, with a card per answer and a progress view by area
> - Runs in the browser (installable), data stays on your device; you need your own Gemini key
>   (there's a free demo mode without one)
> - Can run inside a real Google Meet call so a friend can join as a second interviewer
>
> MIT, no account, no subscription: https://github.com/adeelahmad/Mock
>
> Happy to hear what kind of feedback helped you most in real loops.

### r/selfhosted

**Title:** Mock: a self-hosted AI mock-interview coach, one Go binary with OIDC sign-in and sync

> One static binary (pure Go, SQLite built in, Postgres optional) that serves a voice
> interview-practice PWA, OAuth/OIDC sign-in (GitHub, Google, any OIDC issuer, so Authelia /
> Authentik / Keycloak work), and library sync across browsers. There's also a Proxmox
> community-scripts helper that sets it up in an LXC behind Caddy.
>
> The app is local-first and works without the server; the binary adds sync and a Google Meet
> bridge. The AI is Gemini Live with your own key, which never touches the server.
>
> `curl -fsSL https://raw.githubusercontent.com/adeelahmad/Mock/main/install.sh | sh && mock`
>
> https://github.com/adeelahmad/Mock (MIT). Feedback on the deployment side welcome.

### r/golang

**Title:** One Go binary for a voice AI app: embedded React PWA, OIDC, SQLite, and a Chromium bot that joins Google Meet

> Mock is an interview-practice app; the Go side might be the interesting bit here:
> `go:embed` for the built web app, `golang.org/x/oauth2` + `go-oidc` with PKCE, modernc SQLite
> (CGO_ENABLED=0, so it cross-compiles to four targets in CI), pgx for Postgres, and a Google
> Meet bridge that drives Chromium over the DevTools protocol with chromedp and pipes call audio
> over a local WebSocket.
>
> Code: https://github.com/adeelahmad/Mock (`cmd/mock`, `internal/`). Reviews of the server code
> welcome.

## X / Twitter thread

1/
> Reading your notes isn't rehearsing for a behavioral interview.
>
> So I built Mock: you talk, an AI interviewer asks and follows up, and a coach tells you what to
> fix, judged against your own stories.
>
> Open source, runs in your browser. 🧵 [video]

2/
> The coach knows your prep. If your notes say "41 min to mitigate, $1.2M saved" and you say
> "under an hour, significant", it calls that out. Plus your STAR time split, "I" vs "we", pace,
> fillers. [screenshot: live-dark.png]

3/
> Every session is recorded and gets a report. The next drill leans on your weakest areas.
> Start with Amazon's Leadership Principles or import your own areas as CSV.
> [screenshot: progress-dark.png]

4/
> Local-first: your data and your Gemini key stay in your browser. Want sync? One Go binary does
> the app, OIDC sign-in and sync. It can even join a Google Meet call as the interviewer.

5/
> One line:
> curl -fsSL https://raw.githubusercontent.com/adeelahmad/Mock/main/install.sh | sh
>
> MIT. Stars and feedback welcome 🙏
> https://github.com/adeelahmad/Mock
