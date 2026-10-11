// Mock — "Sample CSV" links: each downloads the template the matching CSV import reads
// (domain/csv-templates.ts), so a user can fill it in and drop it back.

import React from 'react';
import { download } from './ui.tsx';
import { CSV_TEMPLATES, templateBlob, type CsvTemplate } from '../domain/csv-templates.ts';

const LABEL: Record<CsvTemplate, string> = { areas: 'areas', stories: 'stories', questions: 'questions' };

export const downloadTemplate = (t: CsvTemplate): void => download(CSV_TEMPLATES[t].file, templateBlob(t));

/** "Sample CSV: areas · stories · questions" — or one link when `only` is given. */
export default function CsvSamples({ only, label = 'Sample CSV', className = '' }: { only?: CsvTemplate[]; label?: string; className?: string }) {
  const list = only ?? (['areas', 'stories', 'questions'] as CsvTemplate[]);
  return (
    <span className={'csv-samples sub ' + className} style={{ fontSize: 13 }}>
      {label}:{' '}
      {list.map((t, i) => (
        <React.Fragment key={t}>
          {i > 0 && ' · '}
          <button type="button" className="btn link" style={{ padding: 0, height: 'auto', fontSize: 13 }} onClick={() => downloadTemplate(t)} aria-label={'Download the sample ' + LABEL[t] + ' CSV'}>{LABEL[t]}</button>
        </React.Fragment>
      ))}
    </span>
  );
}
