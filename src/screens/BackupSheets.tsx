// Backup and restore sheets (Settings → Library & data). Back up: what goes in (everything,
// library only, sessions only; recordings or not), an optional passphrase, then Download /
// Save to… / Share… as the browser allows. Restore: reads the file, asks for the passphrase when
// it is sealed, says what is inside, then Replace everything or Merge into this library.

import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/store.tsx';
import { saveFile, saveWays, type SaveWay } from '../app/save.ts';
import { Input, Seg, Sheet, Switch } from '../components/ui.tsx';
import { BackupError, applyBackup, buildBackupZip, describeBackup, readBackupFile, type BackupScope, type ReadBackup } from '../db/backup.ts';
import { plural } from '../domain/prep-import.ts';

const fmtBytes = (n: number): string => (n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const WAY_LABEL: Record<SaveWay, string> = { download: 'Download', picker: 'Save to…', share: 'Share…' };

export function BackupSheet({ open, onClose, recordingsDefault = false, recordingCount = 0 }: { open: boolean; onClose: () => void; recordingsDefault?: boolean; recordingCount?: number }) {
  const { repo, refresh, toast } = useApp();
  const [scope, setScope] = useState<BackupScope>('all');
  const [recordings, setRecordings] = useState(recordingsDefault);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setScope('all'); setRecordings(recordingsDefault); setPass(''); setBusy(false); } }, [open, recordingsDefault]);
  const ways = useMemo(() => saveWays(open ? new File(['x'], 'mock.zip', { type: 'application/zip' }) : null), [open]);

  const go = async (way: SaveWay) => {
    setBusy(true);
    try {
      const z = await buildBackupZip(repo, { scope, recordings: recordings && scope !== 'library', passphrase: pass || undefined });
      const ok = await saveFile(new Blob([z.bytes as BlobPart], { type: z.mime }), z.name, way);
      if (!ok) { setBusy(false); return; }
      if (scope === 'all') { await repo.setSettings({ lastBackupAt: new Date().toISOString() }); await refresh(); }
      toast((scope === 'all' ? 'Backup' : 'Export') + ' saved · ' + z.name + ' · ' + fmtBytes(z.bytes.length));
      onClose();
    } catch (e) {
      toast('Backup failed · ' + (e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Back up" eyebrow="Library & data"
      foot={<div className="hstack" style={{ gap: 10, width: '100%' }}>{ways.map((w, i) => <button key={w} className={'btn ' + (i === 0 ? 'primary' : 'ghost') + ' grow'} disabled={busy} onClick={() => void go(w)}>{busy && i === 0 ? 'Packing…' : WAY_LABEL[w]}</button>)}</div>}>
      <div className="stack g14">
        <div className="stack g6">
          <span className="label">What goes in</span>
          <Seg<BackupScope> className="h34" value={scope} onChange={setScope} options={[['all', 'Everything'], ['library', 'Library only'], ['sessions', 'Sessions only']]} />
          <span className="sub" style={{ fontSize: 12 }}>{scope === 'all' ? 'Every table and setting, as JSON and Parquet, plus uploaded files.' : scope === 'library' ? 'LPs, stories, questions and files — no sessions.' : 'Sessions, answers, analysis and transcripts — no stories or files.'}</span>
        </div>
        {scope !== 'library' && (
          <div className="hstack" style={{ justifyContent: 'space-between', gap: 12 }}>
            <span className="stack g2"><span className="srow-title">Include recordings</span><span className="sub" style={{ fontSize: 12 }}>{plural(recordingCount, 'recording')} on this device</span></span>
            <Switch checked={recordings} onChange={setRecordings} label="Include recordings" />
          </div>
        )}
        <Input label="Passphrase · optional" type="password" value={pass} autoComplete="new-password" placeholder="Leave empty for a plain zip"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPass(e.target.value)}
          hint="Encrypts the backup (AES-GCM). Without the passphrase it cannot be restored — Mock does not keep it." />
        <span className="sub" style={{ fontSize: 12 }}>Your Gemini key is never included.</span>
      </div>
    </Sheet>
  );
}

export function RestoreSheet({ file, onClose }: { file: File | null; onClose: () => void }) {
  const { repo, refresh, toast } = useApp();
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [read, setRead] = useState<ReadBackup | null>(null);
  const [needPass, setNeedPass] = useState(false);
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const tryRead = async (b: Uint8Array, p?: string) => {
    setErr('');
    try { setRead(await readBackupFile(b, p)); setNeedPass(false); }
    catch (e) {
      if (e instanceof BackupError && e.code === 'encrypted') setNeedPass(true);
      else if (e instanceof BackupError && e.code === 'passphrase') { setNeedPass(true); setErr(e.message); }
      else setErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    setBytes(null); setRead(null); setNeedPass(false); setPass(''); setErr(''); setBusy(false);
    if (!file) return;
    let alive = true;
    void file.arrayBuffer().then((ab) => { if (!alive) return; const b = new Uint8Array(ab); setBytes(b); void tryRead(b); });
    return () => { alive = false; };
  }, [file]);

  const apply = async (how: 'replace' | 'merge') => {
    if (!read || !file) return;
    if (how === 'replace' && !confirm('Replace everything on this device with ' + file.name + '?')) return;
    setBusy(true);
    try {
      await applyBackup(repo, read, how);
      await refresh();
      toast((how === 'replace' ? 'Restored ' : 'Merged ') + file.name + ' · ' + plural(read.backup.tables.sessions.length, 'session') + ' · ' + plural(read.backup.tables.questions.length, 'question'));
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  return (
    <Sheet open={!!file} onClose={onClose} title="Restore" eyebrow={file?.name}
      foot={read ? (
        <div className="hstack" style={{ gap: 10, width: '100%' }}>
          <button className="btn primary grow" disabled={busy} onClick={() => void apply('replace')}>Replace everything</button>
          <button className="btn ghost grow" disabled={busy} onClick={() => void apply('merge')}>Merge</button>
        </div>
      ) : needPass ? <button className="btn primary block" disabled={!pass || !bytes} onClick={() => bytes && void tryRead(bytes, pass)}>Unlock</button> : undefined}>
      <div className="stack g14">
        {!read && !needPass && !err && <span className="sub">Reading…</span>}
        {needPass && (
          <Input label="Passphrase" type="password" value={pass} autoFocus autoComplete="current-password"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPass(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' && bytes && pass) void tryRead(bytes, pass); }}
            hint="This backup was sealed with a passphrase." />
        )}
        {read && (
          <>
            <div className="card pad stack g6">
              <span className="label">Inside</span>
              <span>{describeBackup(read)}</span>
              {read.manifest && read.manifest.scope !== 'all' && <span className="sub" style={{ fontSize: 12 }}>A partial export ({read.manifest.scope === 'library' ? 'library only' : 'sessions only'}).</span>}
            </div>
            <span className="sub" style={{ fontSize: 13 }}><strong>Replace</strong> wipes this device’s library first. <strong>Merge</strong> keeps it and adds what is new; matching questions and stories are kept once, newer edits win.</span>
          </>
        )}
        {err && <span className="sub" role="alert" style={{ color: 'var(--m-red, #c62828)' }}>{err}</span>}
      </div>
    </Sheet>
  );
}
