// Mock — Google sign-in and meeting creation for the Meet interviewer. Sign-in uses Google
// Identity Services' token client in the browser (no backend, no client secret); the token stays
// in memory. "Create meeting" calls the Meet REST API with the narrow meetings.space.created
// scope and asks for an OPEN space, so the bot can join without being let in when the
// account allows it (otherwise the host admits it, and the sheet says so).

export const MEET_SCOPE = 'https://www.googleapis.com/auth/meetings.space.created';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

/** The OAuth client id: the build's VITE_GOOGLE_CLIENT_ID, else the one typed in the sheet. */
export const buildClientId = (): string => (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_CLIENT_ID ?? '';

interface TokenResponse { access_token?: string; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(o?: { prompt?: string }): void }
interface Gis { accounts: { oauth2: { initTokenClient(o: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string; message?: string }) => void }): TokenClient } } }

let gis: Promise<Gis> | null = null;
function loadGis(): Promise<Gis> {
  const w = window as unknown as { google?: Gis };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
  gis ??= new Promise<Gis>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = GIS_SRC; el.async = true;
    el.onload = () => (w.google?.accounts?.oauth2 ? resolve(w.google) : reject(new Error('Google sign-in did not load')));
    el.onerror = () => { gis = null; reject(new Error('Could not load Google sign-in (offline?)')); };
    document.head.appendChild(el);
  });
  return gis;
}

/** Opens Google's consent popup; resolves with an access token for the Meet scope. Call from a click. */
export async function signInWithGoogle(clientId: string): Promise<string> {
  if (!clientId.trim()) throw new Error('Add a Google OAuth client id first');
  const g = await loadGis();
  return new Promise<string>((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: MEET_SCOPE,
      callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error_description || r.error || 'Google sign-in failed'))),
      error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Sign-in window closed' : e.message || 'Google sign-in failed')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export interface MeetSpace { meetingUri: string; meetingCode: string; name: string }

/** POST /v2/spaces with an OPEN access type. */
export async function createMeetSpace(token: string, fetchFn: typeof fetch = fetch): Promise<MeetSpace> {
  const res = await fetchFn('https://meet.googleapis.com/v2/spaces', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: { accessType: 'OPEN' } }),
  });
  const body = await res.json().catch(() => ({})) as { meetingUri?: string; meetingCode?: string; name?: string; error?: { message?: string } };
  if (!res.ok || !body.meetingUri) {
    if (res.status === 401) throw new Error('Google sign-in expired · sign in again');
    if (res.status === 403) throw new Error('Google refused: ' + (body.error?.message || 'enable the Meet REST API for this OAuth client'));
    throw new Error(body.error?.message || 'Could not create the meeting (' + res.status + ')');
  }
  return { meetingUri: body.meetingUri, meetingCode: body.meetingCode ?? '', name: body.name ?? '' };
}
