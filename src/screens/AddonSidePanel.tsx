// Mock — the Google Meet add-on's side panel, opened from Meet's Add-ons (Meeting tools). It is
// the canvas itself, sized for the panel: practise on your own right there. **Show everyone**
// moves it to the main stage for the whole call (Meet asks the others to join), the way
// whiteboard add-ons do; the main stage is screens/Canvas.tsx with `addon="stage"`.

import { useEffect, useState } from 'react';
import type { MeetSidePanelClient } from '@googleworkspace/meet-addons';
import { ADDON, sidePanel, stageUrl } from '../canvas/addon.ts';
import { Icon } from '../components/ui.tsx';
import Canvas from './Canvas.tsx';

export default function AddonSidePanel() {
  const [client, setClient] = useState<MeetSidePanelClient | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [onStage, setOnStage] = useState(false);

  useEffect(() => {
    let alive = true;
    sidePanel(ADDON.project).then((c) => { if (alive) setClient(c); }, (err) => { if (alive) setError((err as Error).message || 'Could not reach Meet'); });
    return () => { alive = false; };
  }, []);

  const start = async () => {
    if (!client) return;
    setBusy(true); setError('');
    try { await client.startActivity({ mainStageUrl: stageUrl(location, ADDON.project) }); setOnStage(true); }
    catch (err) { setError((err as Error).message || 'Could not open the canvas on the main stage'); }
    setBusy(false);
  };
  const end = async () => {
    try { await client?.endActivity(); } catch { /* already ended */ }
    setOnStage(false);
  };

  if (onStage) {
    return (
      <div className="screen addon-side">
        <div className="screen-body">
          <span className="h3">The canvas is on the main stage</span>
          <span className="sub pretty">You drive it there: your browser hears the call and runs the AI. Everyone who joins sees the same canvas live.</span>
          <button className="btn" onClick={() => void end()}>End it for everyone</button>
        </div>
      </div>
    );
  }

  const bar = (
    <div className="cv-addon-bar">
      <button className="btn sm primary" disabled={!client || busy} onClick={() => void start()}><Icon.Play size={14} />{busy ? 'Opening…' : 'Show everyone'}</button>
      <span className="sub">{error || (client ? 'Opens it on the main stage for the whole call' : 'Connecting to Meet…')}</span>
    </div>
  );
  return <Canvas addon="side" extra={bar} />;
}
