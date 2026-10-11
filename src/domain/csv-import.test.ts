import { describe, it, expect } from 'vitest';
import { csvKind, parseAreasFromCsv, parseQuestionsFromCsv, parseStoriesFromCsv, parseStoriesFile } from './parsers.ts';
import { CSV_TEMPLATES, templateColumns } from './csv-templates.ts';
import { areasFromParsed, importPrepFiles } from './prep-import.ts';
import { MemoryRepo, emptyData } from '../db/memory.ts';
import { LPS } from '../fixtures/sample.ts';

const T = (k: keyof typeof CSV_TEMPLATES) => CSV_TEMPLATES[k].text;

describe('CSV templates', () => {
  it('are each recognised as their own kind', () => {
    expect(csvKind(T('areas'))).toBe('areas');
    expect(csvKind(T('stories'))).toBe('stories');
    expect(csvKind(T('questions'))).toBe('questions');
    expect(templateColumns('stories')).toContain('areas');
  });

  it('round-trip through the parsers', () => {
    const areas = parseAreasFromCsv(T('areas'));
    expect(areas.map((a) => a.name)).toEqual(['Problem Solving', 'Collaboration', 'Delivering Results']);
    expect(areas[0]).toMatchObject({ id: 'problem_solving', short: 'PS' });
    const lps = areasFromParsed(areas, []);
    const stories = parseStoriesFromCsv(T('stories'), lps);
    expect(stories).toHaveLength(2);
    expect(stories[0].lpIds).toEqual(['problem_solving', 'delivering_results']);
    expect(stories[0].numbers[0]).toEqual({ label: 'Time to mitigate', value: '41 min' });
    expect(stories[0].action).toContain('bisected');
    const qs = parseQuestionsFromCsv(T('questions'), lps);
    expect(qs.map((q) => q.lpId)).toEqual(['problem_solving', 'collaboration', 'delivering_results']);
    expect(qs[1].source).toBe('previous');
  });
});

describe('areasFromParsed', () => {
  it('keeps the id of an area that matches by name, so links survive', () => {
    const out = areasFromParsed([{ id: 'dive_deep', name: 'Dive Deep', short: 'DD', description: '' }, { id: 'craft', name: 'Craft', short: 'CR', description: 'x' }], LPS);
    expect(out[0]).toMatchObject({ id: 'deep', name: 'Dive Deep', order: 0 });
    expect(out[0].description).toBe(LPS.find((l) => l.id === 'deep')!.description);
    expect(out[1]).toMatchObject({ id: 'craft', order: 1 });
  });
});

describe('story files', () => {
  it('reads markdown still, by extension', () => {
    expect(parseStoriesFile('s.md', '## A story\nSituation: it broke.\nResult: fixed in 5 min.', LPS)).toHaveLength(1);
    expect(parseStoriesFile('s.csv', T('stories'), LPS)).toHaveLength(2);
  });
});

describe('importPrepFiles with CSVs', () => {
  it('sets the areas, then imports stories and questions against them', async () => {
    const repo = new MemoryRepo(emptyData());
    const file = (name: string, text: string) => new File([text], name, { type: 'text/csv' });
    const r = await importPrepFiles([file('areas.csv', T('areas')), file('stories.csv', T('stories')), file('questions.csv', T('questions'))], { repo, lps: await repo.lps(), stories: [], files: [] });
    expect(r.areas).toBe(3);
    expect(r.stories.count).toBe(2);
    expect(r.questions.count).toBe(3);
    expect((await repo.lps()).map((l) => l.id)).toEqual(['problem_solving', 'collaboration', 'delivering_results']);
    expect((await repo.stories())[1].links).toEqual([{ lpId: 'collaboration', role: 'primary' }]);
  });
});
