// Interview in Google Meet (docs/meet.md) — connect to the local Meet bridge, pick a meeting
// (create one with Google or paste a link), invite Mock, then start a session: it runs in the
// call with the same interviewer, tools, coaching and History as in the app.

import React, { useEffect, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { Input } from '../components/ui.tsx';
import { Seg, Sheet } from '../components/ui.tsx';
import { meet, useMeet, type Listen } from '../meet/meet.ts';
import { MEDIA_SCOPES } from '../meet/media-api.ts';
import { parseMeetLink, type BotStatus } from '../meet/protocol.ts';
import { buildClientId, createMeetSpace, signInWithGoogle } from '../meet/google.ts';

const STATUS: Record<BotStatus, string> = {
  idle: 'Not in a call',
  launching: 'Opening the browser…',
  joining: 'Joining the meeting…',
  waiting: 'Waiting to be let in · admit “Mock” in Meet',
  in_call: 'In the call',
  left: 'Left the call',
  error: 'Could not join',
};

export function MeetSheet({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: (kind: 'drill' | 'loop') => void }) {
  const { gemini, toast } = useApp();
  const bridge = useMeet();
  const [url, setUrl] = useState(meet.saved.url);
  const [code, setCode] = useState(meet.saved.code);
  const [clientId, setClientId] = useState(meet.saved.clientId || buildClientId());
  const [link, setLink] = useState(bridge.meetingUrl);
  const [busy, setBusy] = useState<'' | 'connect' | 'create' | 'media'>('');
  const [listen, setListen] = useState<Listen>(meet.saved.listen);
  const [signedIn, setSignedIn] = useState(meet.hasMediaToken());
  const [error, setError] = useState('');

  useEffect(() => { if (open) { setError(''); if (bridge.meetingUrl) setLink(bridge.meetingUrl); } }, [open]);

  const meeting = parseMeetLink(link);
  const joining = bridge.status === 'launching' || bridge.status === 'joining' || bridge.status === 'waiting';
  const inCall = bridge.connected && bridge.status === 'in_call';

  const connect = async () => {
    setBusy('connect'); setError('');
    try { await meet.connect(url, code); } catch (err) { setError((err as Error).message); }
    setBusy('');
  };
  const create = async () => {
    setBusy('create'); setError('');
    try {
      meet.setClientId(clientId);
      const token = await signInWithGoogle(clientId, listen === 'media' ? MEDIA_SCOPES : []);
      if (listen === 'media') { meet.setMediaToken(token); setSignedIn(true); }
      const space = await createMeetSpace(token);
      setLink(space.meetingUri);
      toast('Meeting created · ' + space.meetingCode + ' · join it from Meet, then invite Mock');
      window.open(space.meetingUri, '_blank', 'noopener');
    } catch (err) { setError((err as Error).message); }
    setBusy('');
  };
  const invite = () => { if (meeting) meet.invite(meeting); };
  const pickListen = (v: Listen) => { setListen(v); meet.setListen(v); };
  const mediaSignIn = async () => {
    setBusy('media'); setError('');
    try { meet.setClientId(clientId); meet.setMediaToken(await signInWithGoogle(clientId, MEDIA_SCOPES)); setSignedIn(true); } catch (err) { setError((err as Error).message); }
    setBusy('');
  };

  const foot = inCall ? (
    <div className="stack g10">
      <div className="hstack" style={{ gap: 10 }}>
        <button type="button" className="btn lg primary grow" disabled={!gemini.hasKey} onClick={() => onStart('drill')}>Start drill in Meet</button>
        <button type="button" className="btn lg" style={{ padding: '0 18px', fontSize: 14 }} disabled={!gemini.hasKey} onClick={() => onStart('loop')}>Full loop</button>
      </div>
      {!gemini.hasKey && <span className="field-hint error">Meet sessions need Gemini Live · add a key in Settings.</span>}
    </div>
  ) : bridge.connected ? (
    <button type="button" className="btn lg ink" disabled={!meeting || joining} onClick={invite}>{joining ? STATUS[bridge.status] : 'Invite Mock to the meeting'}</button>
  ) : (
    <button type="button" className="btn lg ink" disabled={!url.trim() || !code.trim() || busy === 'connect'} onClick={() => void connect()}>{busy === 'connect' ? 'Connecting…' : 'Connect to the bridge'}</button>
  );

  return (
    <Sheet open={open} onClose={onClose} title="Interview in Google Meet" eyebrow="Mock joins the call" foot={foot}>
      <div className="stack g16" data-testid="meet-sheet">
        <div className="stack g8">
          <span className="label">1 · Bridge</span>
          {bridge.connected ? (
            <div className="hstack between">
              <span className="sub">Connected to {meet.saved.url}</span>
              <button type="button" className="text-btn" onClick={() => meet.disconnect()}>Disconnect</button>
            </div>
          ) : (
            <>
              <span className="sub pretty">On this computer run <code className="mono">mock bridge</code> (or <code className="mono">make bridge</code>). It opens a browser that joins the call as Mock, and prints a pairing code.</span>
              <Input label="Bridge address" mono value={url} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)} />
              <Input label="Pairing code" mono value={code} autoComplete="off" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)} placeholder="from the bridge’s first line" />
            </>
          )}
        </div>

        <div className="stack g8">
          <span className="label">2 · Meeting</span>
          <Input label="Meet link or code" mono value={link} disabled={joining || inCall} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLink(e.target.value)} placeholder="https://meet.google.com/abc-defg-hij"
            error={link.trim() && !meeting ? 'That is not a Meet link' : undefined} />
          {!inCall && !joining && (
            <div className="stack g8">
              {!buildClientId() && <Input label="Google OAuth client id (to create meetings)" mono value={clientId} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClientId(e.target.value)} placeholder="….apps.googleusercontent.com" />}
              <button type="button" className="btn" disabled={!clientId.trim() || busy === 'create'} onClick={() => void create()}>{busy === 'create' ? 'Creating…' : 'Sign in with Google · create a meeting'}</button>
            </div>
          )}
        </div>

        <div className="stack g8" data-testid="meet-listen">
          <span className="label">Hear the call through</span>
          <Seg<Listen> value={listen} onChange={pickListen} options={[['bot', 'The bot'], ['media', 'Meet Media API']]} />
          {listen === 'media' && (
            <>
              <span className="sub pretty">Mock opens its own receive-only connection to the call (Developer Preview projects only) and the bot just speaks. If it can’t connect, Mock hears the call through the bot.</span>
              {signedIn ? <span className="sub">Signed in for the Media API</span> : (
                <>
                  {!buildClientId() && <Input label="Google OAuth client id" mono value={clientId} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClientId(e.target.value)} placeholder="….apps.googleusercontent.com" />}
                  <button type="button" className="btn" disabled={!clientId.trim() || busy === 'media'} onClick={() => void mediaSignIn()}>{busy === 'media' ? 'Signing in…' : 'Sign in with Google for the Media API'}</button>
                </>
              )}
            </>
          )}
        </div>

        <div className="stack g8">
          <span className="label">3 · Mock in the call</span>
          <div className="hstack between">
            <span data-testid="meet-status" style={{ font: '700 14px/1.3 var(--font-sans)' }}>{bridge.connected ? STATUS[bridge.status] : 'Bridge not connected'}</span>
            {(inCall || joining) && <button type="button" className="text-btn" onClick={() => meet.leave()}>Remove from call</button>}
          </div>
          {bridge.message && <span className="sub">{bridge.message}</span>}
          {inCall && <span className="sub pretty">Everyone in the call is heard. Use the live screen here to pause, redo or end; the coaching and cards land in History as usual.</span>}
        </div>
        {error && <span className="field-hint error" role="alert">{error}</span>}
      </div>
    </Sheet>
  );
}
