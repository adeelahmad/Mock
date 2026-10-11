// Mock — the session report at session end. `LocalReporter` is arithmetic over the cards
// (domain/report.ts); `GeminiReporter` (gemini/report.ts) asks Flash for the prose and keeps
// the local verdicts. The controller calls whichever it was given once every card is in.

import type { Report } from '../domain/types.ts';
import { localReport, type ReportInput } from '../domain/report.ts';

export interface Reporter {
  report(input: ReportInput): Promise<Report>;
}

export class LocalReporter implements Reporter {
  async report(input: ReportInput): Promise<Report> { return localReport(input); }
}

/** Build the report input for a session from the repository. `windowSessions` earlier sessions feed "biggest improvement". */
export async function reportInput(repo: Pick<import('../db/repo.ts').Repo, 'session' | 'sessions' | 'exchanges' | 'lps' | 'stories'>, sessionId: string, windowSessions = 8): Promise<ReportInput | null> {
  const session = await repo.session(sessionId);
  if (!session) return null;
  const [sessions, all, lps, stories] = await Promise.all([repo.sessions(), repo.exchanges(), repo.lps(), repo.stories()]);
  const earlier = sessions.filter((s) => s.number < session.number).sort((a, b) => b.number - a.number).slice(0, windowSessions);
  return {
    session,
    exchanges: all.filter((e) => e.sessionId === sessionId).sort((a, b) => a.index - b.index),
    previous: earlier.map((s) => ({ session: s, exchanges: all.filter((e) => e.sessionId === s.id) })),
    lps, stories,
  };
}
