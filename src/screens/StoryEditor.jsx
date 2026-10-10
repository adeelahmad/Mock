// Story editor — STAR + learning, key numbers, LP mapping (changed in the grid).
import React, { useEffect, useState } from 'react';
import { BackHead, Input } from '../components/ui.jsx';

const FIELDS = [['situation', 'Situation', 112], ['task', 'Task', 112], ['action', 'Action', 112], ['result', 'Result', 112], ['learning', 'Learning', 88]];

export default function StoryEditor({ story, storyMaps, onBack, onSave, onDelete, onOpenGrid, onStart }) {
  const [draft, setDraft] = useState(story);
  useEffect(() => { setDraft(story); }, [story.id]);
  const dirty = ['title', 'summary', 'situation', 'task', 'action', 'result', 'learning'].some((k) => (draft[k] || '') !== (story[k] || '')) || draft.numbers.join('\n') !== story.numbers.join('\n');
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  return (
    <div className="screen">
      <BackHead onBack={onBack} label="Stories" right={dirty && <button className="btn sm ink" style={{ marginRight: 8 }} onClick={() => onSave(draft)}>Save</button>} />
      <div className="screen-body" style={{ paddingTop: 6, gap: 14 }}>
        <Input value={draft.title} onChange={set('title')} placeholder="Story title" style={{ font: 'inherit' }} className="story-title" />
        <Input label="One-line summary" value={draft.summary || ''} onChange={set('summary')} placeholder="What happened, in one sentence." />
        {FIELDS.map(([k, label, h]) => <Input key={k} label={label} multiline value={draft[k] || ''} onChange={set(k)} style={{ minHeight: h }} />)}
        <div className="stack g8"><span className="h3" style={{ fontSize: 13 }}>Key numbers · one per line</span>
          <textarea className="textarea mono" rows={3} value={draft.numbers.join('\n')} onChange={(e) => setDraft({ ...draft, numbers: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} placeholder={'41 min to mitigate\n$1.2M exposure avoided'} />
          <div className="hstack wrap" style={{ gap: 6 }}>{draft.numbers.map((n, i) => <span key={i} className="num lg">{n}</span>)}</div>
        </div>
        <div className="stack g8"><span className="h3" style={{ fontSize: 13 }}>LP mapping · <button className="text-btn" style={{ color: 'var(--m-cool)' }} onClick={onOpenGrid}>tap the grid to change</button></span>
          <div className="hstack wrap" style={{ gap: 6 }}>
            {storyMaps.map((m) => <span key={m.id} className="chip" style={{ height: 28, padding: '0 10px', gap: 6, letterSpacing: '.06em', background: m.role === 'primary' ? 'var(--m-fg)' : 'transparent', color: m.role === 'primary' ? 'var(--m-card)' : 'var(--m-fg2)', border: m.role === 'primary' ? '1px solid transparent' : '1px solid var(--m-line2)' }}>{m.name} · {m.role}</span>)}
            {storyMaps.length === 0 && <span className="sub">Not mapped to any LP yet.</span>}
          </div>
        </div>
        <button className="btn ghost danger sm" style={{ alignSelf: 'flex-start' }} onClick={onDelete}>Delete story</button>
      </div>
      <div className="screen-foot hstack" style={{ flexDirection: 'row' }}>
        {dirty && <button className="btn lg grow" onClick={() => onSave(draft)}>Save</button>}
        <button className="btn lg primary grow" onClick={() => { if (dirty) onSave(draft); onStart(); }}>Pressure-test this story</button>
      </div>
    </div>
  );
}
