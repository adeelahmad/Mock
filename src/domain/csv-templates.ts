// Mock — the sample CSV files the import flows offer for download. Each one has the header the
// parser reads (parsers.ts: parseAreasFromCsv, parseStoriesFromCsv, parseQuestionsFromCsv) and
// a couple of filled rows to copy. Multi-value cells use ";" between items.

import { splitCsv } from './parsers.ts';

export type CsvTemplate = 'areas' | 'stories' | 'questions';

const cell = (v: string): string => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
const csv = (rows: string[][]): string => rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';

const AREAS = csv([
  ['name', 'short', 'description'],
  ['Problem Solving', 'PS', 'Breaks an unclear problem down, weighs options and explains the trade-offs.'],
  ['Collaboration', 'CB', 'Works across teams, handles disagreement and keeps people aligned.'],
  ['Delivering Results', 'DR', 'Ships on time with the right quality and owns the outcome, setbacks included.'],
]);

const STORIES = csv([
  ['title', 'summary', 'situation', 'task', 'action', 'result', 'learning', 'areas', 'numbers'],
  [
    'Checkout outage', 'Led the recovery of a failing checkout during peak week.',
    'Card payments started failing for 18% of traffic an hour before peak.',
    'Restore payments before peak and keep leadership informed.',
    'Split the team: two engineers bisected recent deploys while I traced the failing path, found a bad config and rolled it back.',
    'Mitigated in 41 minutes; added a kill switch and a config canary. No repeats in six months.',
    'Check the boring config path first.',
    'Problem Solving; Delivering Results', 'Time to mitigate: 41 min; Traffic affected: 18%',
  ],
  [
    'Cross-team API redesign', 'Got three teams to agree on one API contract.',
    'Three teams each wanted a different shape for the orders API.',
    'Agree a contract without slipping the launch.',
    'Ran a short design review, wrote the trade-offs down and proposed a versioned contract everyone could adopt.',
    'All three teams shipped on the new contract; integration bugs fell by half.',
    'Write the trade-offs down before the meeting.',
    'Collaboration', 'Teams aligned: 3; Integration bugs: -50%',
  ],
]);

const QUESTIONS = csv([
  ['question', 'area', 'source', 'difficulty', 'tags', 'sample'],
  ['Tell me about a time you solved a problem with incomplete information.', 'Problem Solving', 'common', '2', '', ''],
  ['Describe a disagreement with another team and how you resolved it.', 'Collaboration', 'previous', '3', 'phone screen', ''],
  ['Tell me about a deadline you nearly missed.', 'Delivering Results', 'custom', '2', '', ''],
]);

export const CSV_TEMPLATES: Record<CsvTemplate, { file: string; text: string }> = {
  areas: { file: 'mock-areas-sample.csv', text: AREAS },
  stories: { file: 'mock-stories-sample.csv', text: STORIES },
  questions: { file: 'mock-questions-sample.csv', text: QUESTIONS },
};

/** The template's header row, for tests and help text. */
export const templateColumns = (t: CsvTemplate): string[] => splitCsv(CSV_TEMPLATES[t].text)[0];

export const templateBlob = (t: CsvTemplate): Blob => new Blob([CSV_TEMPLATES[t].text], { type: 'text/csv' });

/** Rows as CSV text (the stories converter and tests use it). */
export const toCsv = csv;
