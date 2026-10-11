// Account & sync — only when the app is served by the Mock server (the Go binary). Three pieces:
//
//   ServerSetup     first-run wizard on a fresh server: setup token → sign-in providers (OAuth
//                   client id/secret, with the callback URL to register) → who may sign in →
//                   sign in. Admins reopen it from Settings to change providers.
//   SignIn          the gate on a set-up server: sign in to sync, or use Mock on this device only.
//   AccountSection  the Settings block: who is signed in, sync state, sync now, sign out.
//
// Static hosting (GitHub Pages) has no server: none of this shows and Mock stays local-only.

import React, { useEffect, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { paths } from '../app/router.ts';
import { Input } from '../components/ui.tsx';
import { ApiError, callbackUrl, getSetup, saveSetup, signIn, signOut, verifySetupToken, type SetupInput, type SetupView } from '../sync/api.ts';
import type { SyncStatus } from '../sync/engine.ts';
import '../styles/screens/settings.css';

type ProviderKey = 'github' | 'google' | 'oidc';
interface Draft { clientId: string; clientSecret: string; issuer: string; name: string; hasSecret: boolean }
const EMPTY: Draft = { clientId: '', clientSecret: '', issuer: '', name: '', hasSecret: false };

const PROVIDERS: { key: ProviderKey; name: string; where: React.ReactNode }[] = [
  { key: 'github', name: 'GitHub', where: <>GitHub → Settings → Developer settings → <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer">OAuth Apps</a> → New OAuth App.</> },
  { key: 'google', name: 'Google', where: <>Google Cloud console → <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Credentials</a> → Create OAuth client ID → Web application.</> },
  { key: 'oidc', name: 'OpenID Connect', where: <>Any OIDC issuer (Authentik, Keycloak, Auth0, Okta…): create a confidential web client.</> },
];

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function Copyable({ text }: { text: string }) {
  const { toast } = useApp();
  return (
    <button type="button" className="btn xs ghost mono" style={{ justifyContent: 'flex-start', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      title="Copy" onClick={() => { void navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast(text)); }}>{text}</button>
  );
}

function Shell({ step, steps, children, foot }: { step: number; steps: number; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="screen onboarding">
      <div className="screen-head ob-head">
        <span className="wordmark">Mock</span>
        <div className="ob-dots" aria-label={'Step ' + step + ' of ' + steps} role="img">
          {Array.from({ length: steps }, (_, i) => <span key={i} className={'ob-dot' + (i < step ? ' on' : '')} />)}
        </div>
      </div>
      <div className="screen-body ob-body" style={{ gap: 18 }}>{children}</div>
      {foot && <div className="screen-foot ob-foot">{foot}</div>}
    </div>
  );
}

function Title({ title, sub }: { title: React.ReactNode; sub: React.ReactNode }) {
  return <div className="stack g8"><span className="ob-title">{title}</span><span className="ob-sub">{sub}</span></div>;
}

function ProviderButtons() {
  const { account } = useApp();
  const list = account.server?.providers ?? [];
  return (
    <div className="stack g8">
      {list.map((p) => <button key={p.id} className="btn lg cool block" onClick={() => void signIn(p.id, location.href.split('#')[0] + '#' + paths.practice)}>Sign in with {p.name}</button>)}
    </div>
  );
}

/** First-run wizard (and the admin's "Sign-in setup" from Settings). */
export function ServerSetup() {
  const { account, go, toast } = useApp();
  const admin = !!account.server?.user?.admin;
  const [step, setStep] = useState(admin ? 2 : 1);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<ProviderKey, Draft>>({ github: { ...EMPTY }, google: { ...EMPTY }, oidc: { ...EMPTY } });
  const [open, setOpen] = useState<ProviderKey | null>('github');
  const [emails, setEmails] = useState('');
  const [saved, setSaved] = useState<SetupView | null>(null);

  const load = (v: SetupView) => {
    const d = (c: { clientId: string; hasSecret: boolean } | null, extra: Partial<Draft> = {}): Draft => ({ ...EMPTY, clientId: c?.clientId ?? '', hasSecret: !!c?.hasSecret, ...extra });
    setDrafts({ github: d(v.providers.github), google: d(v.providers.google), oidc: d(v.providers.oidc, { issuer: v.providers.oidc?.issuer ?? '', name: v.providers.oidc?.name ?? '' }) });
    setEmails(v.allowedEmails.join('\n'));
    const first = (['github', 'google', 'oidc'] as const).find((k) => v.providers[k]);
    if (first) setOpen(first);
  };
  useEffect(() => { if (admin) void getSetup().then(load).catch((e) => setError(errText(e))); }, [admin]);

  const checkToken = async () => {
    setBusy(true); setError('');
    try {
      if (!(await verifySetupToken(token.trim()))) { setError('That is not the setup token. The server prints it when it starts; `mock token` prints it again.'); return; }
      load(await getSetup(token.trim()));
      setStep(2);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const set = (k: ProviderKey, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [k]: { ...d[k], ...patch } }));
  const filled = (['github', 'google', 'oidc'] as const).filter((k) => drafts[k].clientId.trim());

  const save = async () => {
    setBusy(true); setError('');
    const pick = (k: ProviderKey) => drafts[k].clientId.trim() ? { clientId: drafts[k].clientId.trim(), clientSecret: drafts[k].clientSecret.trim() } : undefined;
    const oidc = pick('oidc');
    const input: SetupInput = {
      providers: { github: pick('github'), google: pick('google'), oidc: oidc ? { ...oidc, issuer: drafts.oidc.issuer.trim(), name: drafts.oidc.name.trim() } : undefined },
      allowedEmails: emails.split(/[\s,;]+/).filter(Boolean),
    };
    try {
      const v = await saveSetup(input, admin ? undefined : token.trim());
      setSaved(v);
      await account.reload();
      setStep(4);
      toast('Sign-in is set up');
    } catch (e) { setError(e instanceof ApiError ? e.message : errText(e)); } finally { setBusy(false); }
  };

  const later = () => { account.skip(true); go(paths.practice); };

  if (step === 1) return (
    <Shell step={1} steps={4} foot={<><button className="btn link" onClick={later}>Use without an account</button><span style={{ flex: 1 }} /><button className="btn lg cool" disabled={!token.trim() || busy} onClick={() => void checkToken()}>Continue</button></>}>
      <Title title="Set up sign-in." sub="This Mock server can keep your library in sync across browsers. First, prove you run it: paste the setup token from the server log." />
      <div className="card pad r12 stack g12">
        <Input label="Setup token" mono autoFocus autoComplete="off" spellCheck={false} value={token} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' && token.trim()) void checkToken(); }}
          error={error || undefined} hint={<>Printed when the server starts. <span className="mono">mock token</span> prints it again (on Proxmox: <span className="mono">mock-token</span>).</>} />
      </div>
    </Shell>
  );

  if (step === 2) return (
    <Shell step={2} steps={4} foot={<>{admin ? <button className="btn link" onClick={() => go(paths.settings)}>Cancel</button> : <button className="btn link" onClick={() => setStep(1)}>Back</button>}<span style={{ flex: 1 }} /><button className="btn lg cool" disabled={!filled.length} onClick={() => { setError(''); setStep(3); }}>Continue</button></>}>
      <Title title="Sign-in providers." sub="Add an OAuth client for at least one. Register the callback URL shown with the provider; the secret is stored on this server only." />
      <div className="list r12">
        {PROVIDERS.map((p) => {
          const d = drafts[p.key];
          const on = open === p.key;
          return (
            <div key={p.key} className="stack" style={{ borderBottom: '1px solid var(--m-line)' }}>
              <button type="button" className="data-row" aria-expanded={on} onClick={() => setOpen(on ? null : p.key)}>
                <span className="data-text"><span className="srow-title">{p.name}</span><span className="srow-sub">{d.clientId ? 'Client ' + d.clientId.slice(0, 18) + (d.clientId.length > 18 ? '…' : '') + (d.clientSecret || d.hasSecret ? ' · secret set' : ' · secret missing') : 'Not set up'}</span></span>
                <span className="link">{on ? 'Close' : d.clientId ? 'Edit' : 'Add'}</span>
              </button>
              {on && (
                <div className="stack g12" style={{ padding: '4px 14px 16px' }}>
                  <span className="sub" style={{ fontSize: 13 }}>{p.where}</span>
                  <div className="stack g4"><span className="field-label">Callback URL</span><Copyable text={callbackUrl(p.key)} /></div>
                  {p.key === 'oidc' && <Input label="Issuer URL" placeholder="https://auth.example.com/application/o/mock/" value={d.issuer} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('oidc', { issuer: e.target.value })} />}
                  {p.key === 'oidc' && <Input label="Button label" placeholder="Single sign-on" value={d.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('oidc', { name: e.target.value })} />}
                  <Input label="Client ID" mono autoComplete="off" spellCheck={false} value={d.clientId} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(p.key, { clientId: e.target.value })} />
                  <Input label="Client secret" type="password" mono autoComplete="off" spellCheck={false} placeholder={d.hasSecret ? 'Saved · leave empty to keep' : ''} value={d.clientSecret} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(p.key, { clientSecret: e.target.value })} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Shell>
  );

  if (step === 3) return (
    <Shell step={3} steps={4} foot={<><button className="btn link" onClick={() => setStep(2)}>Back</button><span style={{ flex: 1 }} /><button className="btn lg cool" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <Title title="Who can sign in?" sub="List the email addresses allowed in, one per line. Leave it empty to let anyone with an account at your providers sign in — fine on a private network, not on the open internet." />
      <div className="card pad r12 stack g12">
        <Input multiline mono aria-label="Allowed emails" placeholder={'you@example.com'} value={emails} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEmails(e.target.value)}
          hint="The first account to sign in becomes the admin and can change this setup later from Settings." error={error || undefined} />
      </div>
    </Shell>
  );

  return (
    <Shell step={4} steps={4} foot={<><button className="btn link" onClick={() => go(admin ? paths.settings : paths.practice)}>{admin ? 'Back to Settings' : 'Later'}</button><span style={{ flex: 1 }} /></>}>
      <Title title={admin ? 'Saved.' : 'Ready. Sign in.'} sub={(saved?.allowedEmails.length ? 'Allowed: ' + saved.allowedEmails.join(', ') + '. ' : '') + 'Your library on this device is uploaded on first sign-in; other browsers signed in as you get the same library.'} />
      {!admin && <ProviderButtons />}
    </Shell>
  );
}

/** Gate on a set-up server when nobody is signed in on this device. */
export function SignIn() {
  const { account, go } = useApp();
  return (
    <Shell step={1} steps={1} foot={<><button className="btn link" onClick={() => { account.skip(true); go(paths.practice); }}>Use without an account</button><span style={{ flex: 1 }} /></>}>
      <Title title="Sign in to sync." sub="Your stories, questions, sessions and progress follow you to every browser you sign in on. Recordings and your Gemini key stay on each device." />
      <ProviderButtons />
    </Shell>
  );
}

export const syncLine = (s: SyncStatus): string => {
  if (s.phase === 'syncing') return 'Syncing…';
  if (s.phase === 'offline') return 'Offline · syncs when back online';
  if (s.phase === 'error') return 'Sync failed · ' + (s.error ?? 'unknown error');
  if (s.pending) return 'Changes waiting to sync';
  if (!s.lastSyncedAt) return 'Not synced yet';
  const mins = Math.round((Date.now() - new Date(s.lastSyncedAt).getTime()) / 60000);
  return 'Synced ' + (mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : new Date(s.lastSyncedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
};

/** Settings → Account & sync. */
export function AccountSection() {
  const { account, go, toast } = useApp();
  const { server, sync } = account;
  if (!server) return null;
  const user = server.user;
  return (
    <div className="stack g8"><span className="label">Account &amp; sync</span>
      <div className="list r12">
        {!server.configured && (
          <button className="data-row" onClick={() => go(paths.serverSetup)}>
            <span className="data-text"><span className="srow-title">Set up sign-in</span><span className="srow-sub">This server can sync your library across browsers · needs the setup token</span></span>
            <span className="link">Open</span>
          </button>
        )}
        {server.configured && !user && server.providers.map((p) => (
          <button key={p.id} className="data-row" onClick={() => void signIn(p.id)}>
            <span className="data-text"><span className="srow-title">Sign in with {p.name}</span><span className="srow-sub">Sync your library across browsers</span></span>
            <span className="link">Sign in</span>
          </button>
        ))}
        {user && (
          <>
            <div className="data-row" style={{ cursor: 'default' }}>
              <span className="data-text"><span className="srow-title">{user.name || user.email || 'Signed in'}</span><span className="srow-sub">{[user.email, user.id.split(':')[0], user.admin ? 'admin' : ''].filter(Boolean).join(' · ')}</span></span>
            </div>
            <button className="data-row" onClick={() => void account.syncNow().then(() => toast(syncLine(account.sync)))}>
              <span className="data-text"><span className="srow-title">Sync now</span><span className="srow-sub" role="status">{syncLine(sync)}</span></span>
              <span className="link">Sync</span>
            </button>
            {user.admin && (
              <button className="data-row" onClick={() => go(paths.serverSetup)}>
                <span className="data-text"><span className="srow-title">Sign-in setup</span><span className="srow-sub">Providers and who may sign in</span></span>
                <span className="link">Open</span>
              </button>
            )}
            <button className="data-row" onClick={() => void signOut(location.href.split('#')[0] + '#' + paths.settings)}>
              <span className="data-text"><span className="srow-title">Sign out</span><span className="srow-sub">The library stays on this device</span></span>
              <span className="link">Sign out</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
