// Mock — the Google Meet add-on's side panel: one button that opens the prep canvas on the
// main stage for everyone in the call (Meet asks the others to join it), and a short how-to.
// Opened from Meet's Activities menu; the main stage is screens/Canvas.tsx with `addon`.

import { useEffect, useState } from 'react';
import type { MeetSidePanelClient } from '@googleworkspace/meet-addons';
import { ADDON, sidePanel, stageUrl } from '../canvas/addon.ts';
import { Wordmark } from '../components/Wordmark.tsx';
import { Icon } from '../components/ui.tsx';

export default function AddonSidePanel() {
  const [client, setClient] = useState<MeetSidePanelClient | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    sidePanel(ADDON.project).then((c) => { if (alive) setClient(c); }, (err) => { if (alive) setError((err as Error).message || 'Could not reach Meet'); });
    return () => { alive = false; };
  }, []);

  const start = async () => {
    if (!client) return;
    setBusy(true); setError('');
    try { await client.startActivity({ mainStageUrl: stageUrl(location, ADDON.project) }); }
    catch (err) { setError((err as Error).message || 'Could not open the canvas'); }
    setBusy(false);
  };

  return (
    <div className="screen addon-side">
      <div className="screen-head"><Wordmark /></div>
      <div className="screen-body">
        <span className="h3">Prep canvas</span>
        <span className="sub pretty">A question, the area it tests, and your spoken answer marked phrase by phrase: green on track, gold drifting, red redo. A whiteboard and the AI chat sit beside it.</span>
        <button className="btn primary" disabled={!client || busy} onClick={() => void start()}><Icon.Play size={18} />{busy ? 'Opening…' : 'Open the canvas for everyone'}</button>
        {!client && !error && <span className="sub">Connecting to Meet…</span>}
        {error && <span className="sub" role="alert" style={{ color: 'var(--m-red)' }}>{error}</span>}
        <span className="sub pretty">Whoever opens it drives: their browser hears the call and runs the AI. Everyone else sees the same canvas live.</span>
      </div>
    </div>
  );
}
