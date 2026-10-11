import { describe, it, expect } from 'vitest';
import { installKind, needsBackup } from './install.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

describe('installKind', () => {
  it('says installed when running standalone', () => expect(installKind({ standalone: true, hasPrompt: true, ua: ANDROID })).toBe('installed'));
  it('offers the browser prompt when Chromium gave one', () => expect(installKind({ standalone: false, hasPrompt: true, ua: ANDROID })).toBe('prompt'));
  it('shows the Home Screen hint on iPhone Safari', () => expect(installKind({ standalone: false, hasPrompt: false, ua: IPHONE })).toBe('ios'));
  it('tells iPad (desktop UA) from a Mac by touch points', () => {
    expect(installKind({ standalone: false, hasPrompt: false, ua: IPAD, maxTouchPoints: 5 })).toBe('ios');
    expect(installKind({ standalone: false, hasPrompt: false, ua: IPAD, maxTouchPoints: 0 })).toBe(null);
  });
  it('offers nothing on Android without a prompt', () => expect(installKind({ standalone: false, hasPrompt: false, ua: ANDROID })).toBe(null));
});

describe('needsBackup', () => {
  const s = (endedAt: string | null) => ({ startedAt: '2026-10-01T09:00:00Z', endedAt });
  it('is quiet with no finished sessions', () => {
    expect(needsBackup(null, [])).toBe(false);
    expect(needsBackup(null, [s(null)])).toBe(false);
  });
  it('nudges when never backed up', () => expect(needsBackup(null, [s('2026-10-01T09:30:00Z')])).toBe(true));
  it('nudges when the last session ended after the last backup', () => expect(needsBackup('2026-10-01T09:00:00Z', [s('2026-09-30T09:30:00Z'), s('2026-10-01T09:30:00Z')])).toBe(true));
  it('is quiet when the backup is newer', () => expect(needsBackup('2026-10-01T10:00:00Z', [s('2026-10-01T09:30:00Z')])).toBe(false));
});
