// Mock — every JSON schema sent to Flash, in one place (plan §6: if the structured-output API
// shape changes, this module and flash.ts are all that move). Standard JSON Schema, as
// `responseJsonSchema` takes it. Measured values (pace, duration, fillers) are not asked for.

const VERDICT = { type: 'string', enum: ['strong_hire', 'inclined', 'not_inclined', 'strong_no_hire'] };
const pct = (description: string) => ({ type: 'integer', minimum: 0, maximum: 100, description });

export const ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    lp: { type: 'string', description: 'The Leadership Principle the question tested, by its full name' },
    storyUsed: { type: ['string', 'null'], description: 'Title of the candidate story they told, exactly as in the story list; null if none matches' },
    betterStory: {
      type: ['object', 'null'],
      description: 'A story from the list that would have answered better, or null if theirs was the best fit',
      properties: { title: { type: 'string' }, reason: { type: 'string', description: 'One sentence: why it fits this LP better' } },
      required: ['title', 'reason'],
    },
    numbersMissed: {
      type: 'array', maxItems: 4,
      description: 'Numbers in the candidate\'s notes for the story they used that they did not say, or said vaguely',
      items: { type: 'object', properties: { notes: { type: 'string', description: 'The number as written in their notes' }, said: { type: 'string', description: 'What they said instead, quoted briefly, or "not said"' } }, required: ['notes', 'said'] },
    },
    star: {
      type: 'object', description: 'Share of the answer spent on each STAR part, adding up to 100',
      properties: { s: pct('Situation'), t: pct('Task'), a: pct('Action'), r: pct('Result') }, required: ['s', 't', 'a', 'r'],
    },
    iWeRatio: { type: 'number', minimum: 0, maximum: 1, description: 'Share of first-person actions said as "I" rather than "we"' },
    delivery: {
      type: 'object',
      properties: { confidence: { type: 'number', minimum: 0, maximum: 1, description: 'How confident they sounded' }, notes: { type: 'string', description: 'One short note on delivery (tone, hedging, rambling)' } },
      required: ['confidence', 'notes'],
    },
    verdict: { ...VERDICT, description: 'Your verdict on this answer as a bar-raising interviewer' },
    spokenVerdict: { type: ['string', 'null'], enum: [...VERDICT.enum, null], description: 'The verdict the coach said aloud in the coaching text, or null if none' },
    strength: { type: 'string', description: 'One strength, one sentence' },
    fixes: { type: 'array', maxItems: 3, items: { type: 'string' }, description: 'Up to three concrete fixes, imperative, one sentence each' },
  },
  required: ['lp', 'storyUsed', 'betterStory', 'numbersMissed', 'star', 'iWeRatio', 'delivery', 'verdict', 'spokenVerdict', 'strength', 'fixes'],
};

export const REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two sentences on how the session went overall' },
    votes: {
      type: 'array', description: 'One per interviewer: the reason behind their vote, one sentence',
      items: { type: 'object', properties: { interviewer: { type: 'string' }, reason: { type: 'string' } }, required: ['interviewer', 'reason'] },
    },
    improvement: { type: 'string', description: 'The biggest improvement against earlier sessions, or an empty string if none' },
    fixes: { type: 'array', maxItems: 3, items: { type: 'string' }, description: 'The three fixes that would move the most verdicts, imperative' },
    storySwaps: {
      type: 'array', description: 'Answers where another of their stories would land better',
      items: { type: 'object', properties: { lpName: { type: 'string' }, useStory: { type: 'string' }, insteadOf: { type: ['string', 'null'] } }, required: ['lpName', 'useStory', 'insteadOf'] },
    },
    nextFocus: { type: 'string', description: 'What to practise next: "{LP name} — {one imperative sentence}"' },
  },
  required: ['summary', 'votes', 'improvement', 'fixes', 'storySwaps', 'nextFocus'],
};
