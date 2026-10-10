// File preview — what the interviewer sees when the file is included.
import React from 'react';
import { BackHead } from '../components/ui.jsx';

export default function FilePreview({ file, onBack, onRemove }) {
  return (
    <div className="screen">
      <BackHead onBack={onBack} label="Files" right={<span className="chip plain" style={{ height: 20, padding: '0 7px', marginRight: 8 }}>{file.type}</span>} />
      <div className="screen-body" style={{ paddingTop: 8 }}>
        <div className="hstack between"><span className="mono" style={{ font: '500 13px/1.2 var(--font-mono)' }}>{file.name}</span><button className="btn ghost danger xs" onClick={onRemove}>Remove</button></div>
        <div className="card" style={{ padding: 16, font: '400 13px/1.7 var(--font-mono)', whiteSpace: 'pre-wrap', minHeight: 200, wordBreak: 'break-word' }}>
          {file.content || 'No content stored for this sample file. Files you drop keep their full text and are sent to the interviewer when included.'}
        </div>
      </div>
    </div>
  );
}
