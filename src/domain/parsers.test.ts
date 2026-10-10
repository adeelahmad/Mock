import { describe, it, expect } from 'vitest';
import {
  normaliseQuestion, isNearDuplicate, guessLp, parseQuestionsFromText, parsedQuestionsFromText, parseQuestionsFromCsv,
  parseStoriesFromMarkdown, parseStoryGrid, detectFileType, parseExponentRows, resolveLp, fileKind,
} from './parsers.ts';

// ---------- normalise + near-duplicate ----------

describe('normaliseQuestion', () => {
  it('lower-cases and strips punctuation and extra whitespace', () => {
    expect(normaliseQuestion('  Tell me about a time   you “missed” a deadline?! ')).toBe('tell me about a time you missed a deadline');
  });
  it('drops apostrophes so "couldn’t" and "couldnt" match', () => {
    expect(normaliseQuestion('Couldn’t you?')).toBe('couldnt you');
  });
});

describe('isNearDuplicate', () => {
  it('is true when the normalised texts are equal', () => {
    expect(isNearDuplicate('Tell me about a time you disagreed with your manager.', 'tell me about a time you disagreed with your manager?')).toBe(true);
  });
  it('is true when the word sets overlap by 85% or more', () => {
    const a = 'tell me about a time when you had to deliver a difficult message to a senior stakeholder and how you prepared for it beforehand';
    const b = 'tell me about a time when you had to deliver a difficult message to a senior stakeholder and how you prepared for it';
    expect(isNearDuplicate(a, b)).toBe(true);
  });
  it('is false for different questions that share an opener', () => {
    expect(isNearDuplicate('Tell me about a time you found a problem that others had missed.', 'Tell me about a time you missed a deadline.')).toBe(false);
  });
  it('is false for empty input', () => {
    expect(isNearDuplicate('', 'anything')).toBe(false);
  });
});

// ---------- guessLp ----------

describe('guessLp', () => {
  it('tags the design’s confident examples with high confidence', () => {
    expect(guessLp('Tell me about a time you found a problem that others had missed.')).toMatchObject({ lpId: 'deep', confidence: 'high' });
    expect(guessLp('Tell me about a time you made a decision without all the data you wanted.')).toMatchObject({ lpId: 'bias', confidence: 'high' });
    expect(guessLp('Describe a time you pushed back on a senior stakeholder.')).toMatchObject({ lpId: 'back', confidence: 'high' });
    expect(guessLp('Tell me about a goal you missed.')).toMatchObject({ lpId: 'deliver', confidence: 'high' });
    expect(guessLp('Tell me about a time you disagreed with your manager.')).toMatchObject({ lpId: 'back', confidence: 'high' });
  });
  it('flags the doubtful ones as low confidence with alternatives', () => {
    const a = guessLp('What would you do differently?');
    expect(a.lpId).toBe('learn');
    expect(a.confidence).toBe('low');
    const b = guessLp('How do you decide what not to build?');
    expect(b.lpId).toBe('frugal');
    expect(b.confidence).toBe('low');
    expect(b.alternatives).toContain('inv');
  });
  it('returns an empty id when nothing matches', () => {
    expect(guessLp('Why do you want this role?')).toEqual({ lpId: '', confidence: 'low', alternatives: [] });
  });
  it('never returns the winner among its alternatives', () => {
    const g = guessLp('Tell me about a time you had to deliver bad news to a customer under a tight deadline.');
    expect(g.alternatives).not.toContain(g.lpId);
  });
});

// ---------- questions from markdown / plain text ----------

const NOTES = `# AWS loop — March 2024

Five rounds, SDM II. Outcome: no offer.

## Round 3 · Bar raiser
- “Tell me about a time you found a problem others had missed.” — went long on context, result thin.
- Follow-up: “How did you know it was the config?” — couldn’t quote the number.
- Asked for a second example; used the migration story.
- “Decision without all the data.” — fraud MVP. Good.

## Round 4 · Skip-level
1. Tell me about a time you made a decision without all the data you wanted?
2. **What would you do differently?** — rambled.
> Tell me about a time you made a decision without all the data you wanted?
- Why?
`;

describe('parseQuestionsFromText', () => {
  const qs = parseQuestionsFromText(NOTES);
  it('finds quoted questions and lines ending in ?', () => {
    expect(qs).toContain('Tell me about a time you found a problem others had missed.');
    expect(qs).toContain('How did you know it was the config?');
    expect(qs).toContain('What would you do differently?');
    expect(qs).toContain('Tell me about a time you made a decision without all the data you wanted?');
  });
  it('strips list markers, numbers, blockquotes, bold and "Follow-up:" prefixes', () => {
    for (const q of qs) expect(q).not.toMatch(/^[-*>\d.\s]|\*\*|^Follow-up/i);
  });
  it('skips notes, too-short lines and non-questions', () => {
    expect(qs).not.toContain('Decision without all the data.');
    expect(qs).not.toContain('Why?');
    expect(qs.some((q) => /went long on context/.test(q))).toBe(false);
  });
  it('dedups repeated questions', () => {
    expect(qs.filter((q) => q.startsWith('Tell me about a time you made a decision')).length).toBe(1);
  });
  it('ignores lines over 240 characters', () => {
    expect(parseQuestionsFromText('Tell me ' + 'about a time '.repeat(30) + '?')).toEqual([]);
  });
  it('returns nothing for empty input', () => {
    expect(parseQuestionsFromText('')).toEqual([]);
  });
});

describe('parsedQuestionsFromText', () => {
  it('attaches an LP guess and the source to every line', () => {
    const rows = parsedQuestionsFromText('- Tell me about a time you disagreed with your manager?\n', 'previous');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: 'Tell me about a time you disagreed with your manager?', lpId: 'back', confidence: 'high', source: 'previous' });
  });
});

// ---------- CSV ----------

describe('parseQuestionsFromCsv', () => {
  it('reads a header-led file with text, lp, source and difficulty columns', () => {
    const csv = 'question,lp,source,difficulty\n"Tell me about a time you refused to ship something, and why.",Insist on the Highest Standards,previous,hard\nGive me an example of a complex process you simplified.,inv,common,1\n';
    const rows = parseQuestionsFromCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ text: 'Tell me about a time you refused to ship something, and why.', lpId: 'std', confidence: 'high', source: 'previous', difficulty: 3 });
    expect(rows[1]).toMatchObject({ lpId: 'inv', source: 'common', difficulty: 1 });
  });
  it('guesses the LP when the column is empty and accepts a short label', () => {
    const rows = parseQuestionsFromCsv('text,lp\nTell me about a time you disagreed with your manager.,\nTell me about a metric you distrusted.,DD\n');
    expect(rows[0]).toMatchObject({ lpId: 'back', confidence: 'high' });
    expect(rows[1]).toMatchObject({ lpId: 'deep', confidence: 'high' });
  });
  it('treats a file without a header as one question per line', () => {
    const rows = parseQuestionsFromCsv('Tell me about a time you disagreed with your manager.\nTell me about a goal you missed.\n');
    expect(rows.map((r) => r.text)).toEqual(['Tell me about a time you disagreed with your manager.', 'Tell me about a goal you missed.']);
    expect(rows[0].source).toBeNull();
  });
  it('dedups and skips blank rows', () => {
    const rows = parseQuestionsFromCsv('text\nTell me about a goal you missed.\n\nTell me about a goal you missed?\n');
    expect(rows).toHaveLength(1);
  });
});

// ---------- stories from markdown ----------

const STORIES_MD = `# My stories

## Region failover drill
Ran the first full-region failover of the payments stack; proved we could lose eu-west-1.

### Situation
Leadership had never signed off a failover drill because nobody owned it.
### Task
Own the drill end to end and get a clean cutover before peak.
### Action
I wrote the runbook myself, then ran it with 3 teams on a Sunday.
### Result
- 11 min cutover
- 0 customer-visible errors
- Runbook adopted by 4 teams
### Learning
Say the number first.

LPs: Ownership, Dive Deep

## Intern programme
**Situation:** We had no intern pipeline and hiring was slow.
**Task:** Build one from scratch.
**Action:** Partnered with two universities; wrote the interview loop.
**Result:** Six interns, four converted.

## Pricing experiment
Tested a usage-based price on 10% of new sign-ups for 6 weeks.
Key numbers: +18% conversion · 6 weeks · 10% of sign-ups
I was wrong about the elasticity and said so to the exec team; we thought bigger than the original plan.
`;

describe('parseStoriesFromMarkdown', () => {
  const stories = parseStoriesFromMarkdown(STORIES_MD);
  it('turns each ## heading into a story', () => {
    expect(stories.map((s) => s.title)).toEqual(['Region failover drill', 'Intern programme', 'Pricing experiment']);
  });
  it('reads ### STAR sections and bold labels', () => {
    expect(stories[0].situation).toMatch(/never signed off/);
    expect(stories[0].task).toMatch(/Own the drill/);
    expect(stories[0].action).toMatch(/runbook myself/);
    expect(stories[0].result).toMatch(/11 min cutover/);
    expect(stories[0].learning).toBe('Say the number first.');
    expect(stories[1].situation).toBe('We had no intern pipeline and hiring was slow.');
    expect(stories[1].result).toBe('Six interns, four converted.');
  });
  it('keeps the first paragraph as the summary', () => {
    expect(stories[0].summary).toMatch(/^Ran the first full-region failover/);
    expect(stories[2].summary).toMatch(/^Tested a usage-based price/);
  });
  it('detects key numbers from bullets with digits and "Key numbers:" lines', () => {
    expect(stories[0].numbers.map((n) => n.value)).toEqual(['11 min cutover', '0 customer-visible errors', 'Runbook adopted by 4 teams']);
    expect(stories[1].numbers).toEqual([]);
    expect(stories[2].numbers.map((n) => n.value)).toEqual(['+18% conversion', '6 weeks', '10% of sign-ups']);
  });
  it('links LPs named in the text and suggests by keyword otherwise', () => {
    expect(stories[0].lpIds).toEqual(['own', 'deep']);
    expect(stories[0].suggestedLpIds).toEqual(['own', 'deep']);
    expect(stories[1].lpIds).toEqual([]);
    expect(stories[1].suggestedLpIds[0]).toBe('hire');
    expect(stories[2].suggestedLpIds.length).toBeGreaterThan(0);
  });
  it('returns nothing when there are no headings', () => {
    expect(parseStoriesFromMarkdown('just some text\nwith no headings')).toEqual([]);
  });
  it('treats a single # heading as one story when there are no ## headings', () => {
    const one = parseStoriesFromMarkdown('# Payments outage\nSituation: Black Friday, 07:40.\nResult: 41 min to mitigate.\n- 41 min to mitigate\n');
    expect(one).toHaveLength(1);
    expect(one[0].title).toBe('Payments outage');
    expect(one[0].situation).toBe('Black Friday, 07:40.');
    expect(one[0].numbers.map((n) => n.value)).toEqual(['41 min to mitigate']);
  });
});

// ---------- story × LP grid ----------

describe('parseStoryGrid', () => {
  it('reads a markdown table with P/S/x cells', () => {
    const md = `| Story | Dive Deep | OW | bias | Unknown |
|---|---|---|---|---|
| Payments outage | P | S | x | P |
| Hiring bar reset | | | | |
`;
    const g = parseStoryGrid(md);
    expect(g.lpIds).toEqual(['deep', 'own', 'bias', null]);
    expect(g.rows[0].title).toBe('Payments outage');
    expect(g.rows[0].links).toEqual([{ lpId: 'deep', role: 'primary' }, { lpId: 'own', role: 'secondary' }, { lpId: 'bias', role: 'primary' }]);
    expect(g.rows[1].links).toEqual([]);
  });
  it('returns an empty grid without a table', () => {
    expect(parseStoryGrid('no table here')).toEqual({ lpIds: [], rows: [] });
  });
});

// ---------- helpers ----------

describe('resolveLp', () => {
  it('matches by id, name, short and loose punctuation', () => {
    expect(resolveLp('deep')).toBe('deep');
    expect(resolveLp('Dive Deep')).toBe('deep');
    expect(resolveLp('DD')).toBe('deep');
    expect(resolveLp('Are Right A Lot')).toBe('right');
    expect(resolveLp('Have Backbone')).toBe('back');
    expect(resolveLp('nothing like it')).toBe('');
  });
});

describe('detectFileType', () => {
  it('ports the prototype’s content rules', () => {
    expect(detectFileType('# Senior SDM\n## What you will do\n- Own the roadmap')).toBe('JD');
    expect(detectFileType('# AWS loop — March 2024\nFive rounds.')).toBe('Past interviews');
    expect(detectFileType('# Phone screen feedback\n- Asked to quantify more.')).toBe('Past interviews');
    expect(detectFileType('# Background\nSenior engineering manager, 11 years.')).toBe('Background');
    expect(detectFileType('- Working Backwards\n- The Amazon Way')).toBe('Other');
  });
});

describe('fileKind', () => {
  it('classifies by extension', () => {
    expect(fileKind('bank.csv')).toBe('csv');
    expect(fileKind('export.json')).toBe('json');
    expect(fileKind('export.json.zst')).toBe('zst');
    expect(fileKind('notes.md')).toBe('text');
    expect(fileKind('notes')).toBe('text');
  });
});

describe('parseExponentRows', () => {
  it('reads the distilled bank shape', () => {
    const rows = parseExponentRows(JSON.stringify([{ id: 'x1', text: 'Tell me about a time you disagreed with your manager.', lp_id: 'back', source: 'exponent', difficulty: 2, tags: 'Amazon, Meta', votes: 12, amazon: true, sample: 'Top answer' }]));
    expect(rows).not.toBeNull();
    expect(rows![0]).toMatchObject({ text: 'Tell me about a time you disagreed with your manager.', lpId: 'back', confidence: 'high', source: 'common', difficulty: 2, tags: 'Amazon, Meta', votes: 12, sample: 'Top answer' });
  });
  it('reads the raw export shape, keeps behavioural questions and sorts Amazon first', () => {
    const raw = { results: [
      { id: 1, category: ['system-design'], data: { title: 'Design a URL shortener' }, companies: [{ name: 'Amazon' }] },
      { id: 2, category: ['behavioral'], data: { title: 'Tell me about a time you missed a deadline.' }, companies: [{ name: 'Meta' }], votes: 3, difficulty: 'easy' },
      { id: 3, category: [], data: { title: 'Describe a time you had to deliver bad news.' }, companies: [{ name: 'Amazon' }, { name: 'Opendoor' }], votes: 1, difficulty: 'hard', topComment: { comment: 'I  said   it plainly.' } },
    ] };
    const rows = parseExponentRows(JSON.stringify(raw))!;
    expect(rows.map((r) => r.text)).toEqual(['Describe a time you had to deliver bad news.', 'Tell me about a time you missed a deadline.']);
    expect(rows[0]).toMatchObject({ tags: 'Amazon, Opendoor', difficulty: 3, sample: 'I said it plainly.', lpId: 'trust' });
    expect(rows[1]).toMatchObject({ difficulty: 1, lpId: 'deliver' });
  });
  it('returns null for text that is not an export', () => {
    expect(parseExponentRows('not json')).toBeNull();
    expect(parseExponentRows('{"hello":1}')).toBeNull();
  });
});
