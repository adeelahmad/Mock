// Settings → Sync with a passphrase (src/vault). No account and no server: the user's devices
// find each other through a relay and trade the library directly, end-to-end encrypted.
//
//   off   Turn on: type or generate a passphrase, or pair with a code from another device
//   on    how many devices are connected, Pair a device (code + QR), the relay, Turn off
//
// A pairing link (…#/practice/settings?pair=42-violet-anchor, what the QR code holds) opens the
// join sheet with the code filled in.

import React, { useEffect, useMemo, useState } from 'react';
import { renderSVG } from 'uqr';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { Input, Seg, Sheet, Switch } from '../components/ui.tsx';
import { deriveMaster, fromB64, generatePassphrase, MIN_BITS, passphraseBits } from '../vault/keys.ts';
import { formatCode, host, join, parseCode, type Pairing } from '../vault/pair.ts';
import { DEFAULT_CONFIG, defaultSignal, packPairing, unpackPairing, type ServerHint, type VaultConfig, type VaultStatus } from '../vault/vault.ts';

export const pairLink = (code: string): string => location.href.split('#')[0] + '#' + paths.settings + '?pair=' + encodeURIComponent(code);

export function vaultLine(s: VaultStatus): string {
  if (s.phase === 'starting') return 'Starting…';
  if (s.phase === 'error') return 'Sync stopped · ' + (s.error ?? 'unknown error');
  if (s.signal === 'connecting' && !s.peers) return 'Reaching the relay…';
  if (s.peers) return 'Live with ' + s.peers + ' other device' + (s.peers === 1 ? '' : 's');
  if (s.connecting) return 'Connecting to another device…';
  return 'On · waiting for your other devices';
}

const relayName = (c: VaultConfig, hint: ServerHint | null): string =>
  c.relay === 'server' && c.serverUrl ? 'Mock server · ' + new URL(c.serverUrl).host
    : c.relay !== 'nostr' && hint && hint.signal !== 'off' && (hint.signal === 'open' || hint.signedIn) ? 'This Mock server'
      : 'Public Nostr relays';

/** Opens the server's /signal/connect page; resolves with the relay token it hands back. */
function connectServer(raw: string): Promise<{ url: string; token: string }> {
  let base: URL;
  try { base = new URL(raw.includes('://') ? raw : 'https://' + raw); } catch { return Promise.reject(new Error('That is not a web address')); }
  const url = new URL('signal/connect', base.toString().replace(/\/?$/, '/'));
  url.searchParams.set('origin', location.origin);
  const w = window.open(url.toString(), 'mock-connect', 'width=460,height=640');
  if (!w) return Promise.reject(new Error('Allow pop-ups for this site, then try again'));
  return new Promise((resolve, reject) => {
    const done = (e?: Error) => { removeEventListener('message', on); clearInterval(t); if (e) reject(e); };
    const on = (e: MessageEvent) => {
      if (e.origin !== base.origin || !e.data || e.data.type !== 'mock-signal') return;
      done(); resolve({ url: String(e.data.url || base.toString()), token: String(e.data.token) });
    };
    const t = setInterval(() => { if (w.closed) done(new Error('The sign-in window was closed')); }, 800);
    addEventListener('message', on);
  });
}

/** Where devices meet: public relays, or a Mock server (this one, or one signed in to). */
function RelayPicker({ config, onChange }: { config: VaultConfig; onChange: (c: VaultConfig) => void }) {
  const { account } = useApp();
  const own = !!account.hint && account.hint.signal !== 'off';
  const [url, setUrl] = useState(config.serverUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const mode = config.relay === 'server' ? 'server' : config.relay === 'nostr' || !own ? 'nostr' : 'auto';
  const options: [string, React.ReactNode][] = own ? [['auto', 'This server'], ['nostr', 'Public relays'], ['server', 'Another server']] : [['nostr', 'Public relays'], ['server', 'My Mock server']];
  const connect = async () => {
    setBusy(true); setErr('');
    try { const r = await connectServer(url); onChange({ ...config, relay: 'server', serverUrl: r.url, serverToken: r.token }); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="stack g6">
      <span className="label">Where your devices meet</span>
      <Seg value={mode} options={options} onChange={(v) => onChange({ ...config, relay: v as VaultConfig['relay'] })} />
      {mode === 'nostr' && <span className="sub" style={{ fontSize: 12 }}>Free public Nostr relays carry only encrypted hellos; your library goes device to device.</span>}
      {mode === 'auto' && <span className="sub" style={{ fontSize: 12 }}>The Mock server serving this page, for devices signed in to it.</span>}
      {mode === 'server' && (
        <>
          <div className="hstack" style={{ gap: 8, alignItems: 'flex-end' }}>
            <Input label="Mock server address" placeholder="https://mock.example.com" value={url} style={{ flex: 1 }} autoComplete="url" spellCheck={false}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)} />
            <button className="btn ghost" disabled={busy || !url} onClick={() => void connect()}>{busy ? 'Signing in…' : config.serverToken && config.serverUrl.startsWith(url) ? 'Reconnect' : 'Sign in'}</button>
          </div>
          <span className={'sub' + (err ? ' error' : '')} style={{ fontSize: 12 }}>{err || (config.serverToken ? 'Signed in to ' + new URL(config.serverUrl).host + '.' : 'Your self-hosted Mock (for example behind a Cloudflare Tunnel). You sign in there once.')}</span>
        </>
      )}
    </div>
  );
}

function TurnOnSheet({ open, onClose, initialCode }: { open: boolean; onClose: () => void; initialCode: string }) {
  const { account, toast } = useApp();
  const [tab, setTab] = useState<'pass' | 'code'>('pass');
  const [pass, setPass] = useState('');
  const [shown, setShown] = useState(false);
  const [code, setCode] = useState('');
  const [config, setConfig] = useState<VaultConfig>(DEFAULT_CONFIG);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [pairing, setPairing] = useState<Pairing<Uint8Array> | null>(null);
  useEffect(() => {
    if (!open) return;
    setTab(initialCode ? 'code' : 'pass'); setCode(initialCode); setPass(''); setShown(false); setBusy(''); setErr(''); setConfig(DEFAULT_CONFIG);
  }, [open, initialCode]);
  useEffect(() => () => pairing?.cancel(), [pairing]);
  const bits = passphraseBits(pass);

  const turnOn = async () => {
    setBusy('Deriving your key…'); setErr('');
    try {
      const master = await deriveMaster(pass);
      await account.vault.enable(master, config, account.hint);
      toast('Sync is on · open Mock on your other devices with the same passphrase');
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(''); }
  };
  const pair = async () => {
    const c = parseCode(code);
    if (!c) { setErr('A code looks like 42-violet-anchor'); return; }
    setBusy('Waiting for the other device…'); setErr('');
    const { signal } = defaultSignal(config, account.hint);
    const p = join(signal, c);
    setPairing(p);
    try {
      const saved = unpackPairing(await p.done);
      await account.vault.enable(fromB64(saved.master), saved.config, account.hint);
      toast('Paired · your library is on its way');
      onClose();
    } catch (e) { if ((e as Error).message !== 'cancelled') setErr((e as Error).message); setBusy(''); }
    finally { signal.close(); setPairing(null); }
  };

  const foot = tab === 'pass'
    ? <button className="btn primary grow" disabled={!!busy || bits < MIN_BITS} onClick={() => void turnOn()}>{busy || 'Turn on sync'}</button>
    : <button className="btn primary grow" disabled={!!busy || !code.trim()} onClick={() => void pair()}>{busy || 'Pair'}</button>;
  return (
    <Sheet open={open} onClose={() => { pairing?.cancel(); onClose(); }} title="Sync your devices" eyebrow="No account needed" foot={<div className="hstack" style={{ width: '100%' }}>{foot}</div>}>
      <div className="stack g14">
        <Seg value={tab} options={[['pass', 'Passphrase'], ['code', 'Pair with a code']]} onChange={(v) => { setTab(v); setErr(''); }} />
        {tab === 'pass' ? (
          <>
            <Input label="Passphrase" type={shown ? 'text' : 'password'} value={pass} autoComplete="new-password" spellCheck={false} mono={shown}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPass(e.target.value)}
              hint={pass ? (bits < MIN_BITS ? 'Too easy to guess. Use more words, or generate one.' : 'Strong enough · about ' + bits + ' bits') : 'The same passphrase on every device opens the same library. Mock never stores it.'} />
            <div className="hstack" style={{ gap: 8 }}>
              <button className="btn ghost" onClick={() => { setPass(generatePassphrase()); setShown(true); }}>Generate one</button>
              <button className="btn link" onClick={() => setShown((x) => !x)}>{shown ? 'Hide' : 'Show'}</button>
            </div>
            <span className="sub" style={{ fontSize: 12 }}>Write it down. Anyone with it can open your library, and nobody can recover it for you; a device that already syncs can pair a new one with a code instead.</span>
            <div className="hstack" style={{ justifyContent: 'space-between', gap: 12 }}>
              <span className="stack g2"><span className="srow-title">Sync my Gemini key too</span><span className="sub" style={{ fontSize: 12 }}>Encrypted like everything else</span></span>
              <Switch checked={config.syncSecrets} onChange={(on) => setConfig({ ...config, syncSecrets: on })} label="Sync my Gemini key too" />
            </div>
          </>
        ) : (
          <>
            <Input label="Code from your other device" placeholder="42-violet-anchor" value={code} mono autoComplete="off" spellCheck={false} autoCapitalize="off"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)}
              hint="On a device that already syncs: Settings, Sync, Pair a device." />
          </>
        )}
        <RelayPicker config={config} onChange={setConfig} />
        {err && <span className="field-hint error" role="alert">{err}</span>}
      </div>
    </Sheet>
  );
}

function PairSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { account, toast } = useApp();
  const [p, setP] = useState<Pairing<boolean> | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    const saved = account.vault.saved;
    if (!saved) return;
    setErr('');
    const { signal } = defaultSignal(saved.config, account.hint);
    const h = host(signal, packPairing(saved));
    setP(h);
    // After success the host lingers a few seconds in case its last message was lost.
    h.done.then(() => { toast('Paired · the new device is syncing'); onClose(); setTimeout(() => signal.close(), 25_000); }, (e: Error) => { signal.close(); if (e.message !== 'cancelled') setErr(e.message); });
    return () => h.cancel();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const code = p ? formatCode(p.code) : '';
  const link = code ? pairLink(code) : '';
  const qr = useMemo(() => (link ? renderSVG(link, { border: 1, pixelSize: 6 }) : ''), [link]);
  return (
    <Sheet open={open} onClose={onClose} title="Pair a device" eyebrow="Sync">
      <div className="stack g14" style={{ alignItems: 'center', textAlign: 'center' }}>
        <span className="sub">On the new device, open Mock, then Settings, Sync, Pair with a code. Or scan this.</span>
        {qr && <div className="vault-qr" aria-label="QR code for the pairing link" role="img" dangerouslySetInnerHTML={{ __html: qr }} />}
        <span className="vault-code" data-testid="pair-code">{code}</span>
        {err ? <span className="field-hint error" role="alert">{err}</span> : <span className="sub" style={{ fontSize: 12 }}>Waiting… The code works once, for ten minutes.</span>}
        {link && <button className="btn link" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast('Link copied'))}>Copy link</button>}
      </div>
    </Sheet>
  );
}

/** Settings → Sync. */
export function VaultSection() {
  const { account, route, go } = useApp();
  const s = account.vaultStatus;
  const saved = account.vault.saved;
  const pairCode = route.query.get('pair') ?? '';
  const [sheet, setSheet] = useState<'on' | 'pair' | 'relay' | null>(null);
  useEffect(() => { if (pairCode && !s.on) setSheet('on'); }, [pairCode]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setSheet(null); if (pairCode) go(paths.settings, true); };
  const [config, setConfig] = useState<VaultConfig>(saved?.config ?? DEFAULT_CONFIG);
  const [turn, setTurn] = useState('');
  useEffect(() => {
    if (sheet !== 'relay') return;
    const c = account.vault.saved?.config ?? DEFAULT_CONFIG;
    setConfig(c); setTurn(formatTurn(c.turn));
  }, [sheet]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack g8"><span className="label">Sync</span>
      <div className="list r12">
        {!s.on ? (
          <button className="data-row" onClick={() => setSheet('on')}>
            <span className="data-text"><span className="srow-title">Sync with a passphrase</span><span className="srow-sub">Your devices sync directly, end-to-end encrypted · no account, no server</span></span>
            <span className="link">Turn on</span>
          </button>
        ) : (
          <>
            <div className="data-row" style={{ cursor: 'default' }}>
              <span className="data-text"><span className="srow-title">Passphrase sync</span><span className="srow-sub" role="status" data-testid="vault-status">{vaultLine(s)}{s.id ? ' · vault ' + s.id : ''}</span></span>
            </div>
            <button className="data-row" onClick={() => setSheet('pair')}>
              <span className="data-text"><span className="srow-title">Pair a device</span><span className="srow-sub">A short code or QR code, instead of typing the passphrase</span></span>
              <span className="link">Pair</span>
            </button>
            <button className="data-row" onClick={() => setSheet('relay')}>
              <span className="data-text"><span className="srow-title">Where devices meet</span><span className="srow-sub">{saved ? relayName(saved.config, account.hint) : ''}</span></span>
              <span className="link">Change</span>
            </button>
            <button className="data-row" onClick={() => void account.vault.forget()}>
              <span className="data-text"><span className="srow-title">Turn off on this device</span><span className="srow-sub">The library stays here; the key is forgotten</span></span>
              <span className="link">Turn off</span>
            </button>
          </>
        )}
      </div>
      <TurnOnSheet open={sheet === 'on'} onClose={close} initialCode={pairCode} />
      <PairSheet open={sheet === 'pair'} onClose={close} />
      <Sheet open={sheet === 'relay'} onClose={close} title="Where devices meet" eyebrow="Sync"
        foot={<div className="hstack" style={{ width: '100%' }}><button className="btn primary grow" onClick={() => void account.vault.updateConfig({ ...config, turn: parseTurn(turn) }, account.hint).then(close)}>Save</button></div>}>
        <div className="stack g14">
          <RelayPicker config={config} onChange={setConfig} />
          <Input label="TURN server · optional" placeholder="turn:user:pass@turn.example.com:3478" mono spellCheck={false}
            value={turn} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTurn(e.target.value)}
            hint="Only when two devices never connect (some mobile networks). A tunnel cannot carry TURN; it needs its own UDP port." />
        </div>
      </Sheet>
    </div>
  );
}

/** "turn:user:pass@host:3478 turns:…" → RTCIceServer[] */
export function parseTurn(raw: string): RTCIceServer[] {
  return raw.split(/\s+/).filter(Boolean).flatMap((u) => {
    const m = u.match(/^(turns?):(?:([^:@]+):([^@]*)@)?(.+)$/);
    return m ? [{ urls: m[1] + ':' + m[4], ...(m[2] ? { username: decodeURIComponent(m[2]), credential: decodeURIComponent(m[3]) } : {}) }] : [];
  });
}

export const formatTurn = (ts: RTCIceServer[]): string => ts.map((t) => {
  const u = Array.isArray(t.urls) ? t.urls[0] : t.urls;
  return t.username ? u.replace(/^(turns?):/, (m) => m + encodeURIComponent(t.username!) + ':' + encodeURIComponent(String(t.credential ?? '')) + '@') : u;
}).join(' ');
