// Mock — the browser side of the Mock server API (internal/server, the Go binary). Every call is same-origin
// (the server serves the app, or Vite proxies /api and /auth in dev). On a static host with no
// server, `status()` resolves null and the app stays local-only.

import type { MockBackup } from '../db/backup.ts';
import type { PushResult, RemoteLibrary, SyncApi } from './engine.ts';

export interface ServerUser { id: string; name: string | null; email: string | null; image: string | null; admin: boolean }
export interface ServerStatus { server: true; version: string; db: string; configured: boolean; providers: { id: string; name: string }[]; user: ServerUser | null }
export interface ClientView { clientId: string; hasSecret: boolean }
export interface SetupView { configured: boolean; providers: { github: ClientView | null; google: ClientView | null; oidc: (ClientView & { issuer: string; name: string }) | null }; allowedEmails: string[]; hasAdmin: boolean }
export interface SetupInput {
  providers: { github?: { clientId: string; clientSecret: string }; google?: { clientId: string; clientSecret: string }; oidc?: { clientId: string; clientSecret: string; issuer: string; name: string } };
  allowedEmails: string[];
}

/** The server root: the directory the app is served from (relative base './'). */
export const serverUrl = (path: string): string => new URL(path.replace(/^\//, ''), new URL('.', location.href)).toString();

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T | null }> {
  const res = await fetch(serverUrl(path), {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), accept: 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = res.status === 204 ? '' : await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok && res.status !== 409) throw new ApiError(res.status, (data as { message?: string } | null)?.message ?? res.statusText ?? 'Request failed');
  return { status: res.status, data: data as T | null };
}

/** null when there is no Mock server behind this site (static hosting, offline). */
export async function status(): Promise<ServerStatus | null> {
  try {
    const { data } = await call<ServerStatus>('GET', 'api/status');
    return data && data.server === true ? data : null;
  } catch { return null; }
}

export const verifySetupToken = async (token: string): Promise<boolean> => {
  try { await call('POST', 'api/setup/verify', { token }); return true; } catch (e) { if (e instanceof ApiError && e.status === 403) return false; throw e; }
};
export const getSetup = async (token?: string): Promise<SetupView> => (await call<SetupView>('GET', 'api/setup', undefined, token ? { 'x-setup-token': token } : {})).data!;
export const saveSetup = async (input: SetupInput, token?: string): Promise<SetupView> => (await call<SetupView>('PUT', 'api/setup', input, token ? { 'x-setup-token': token } : {})).data!;

/** Auth.js sign-in and sign-out are form POSTs carrying its CSRF token; the browser follows the redirects. */
async function authPost(action: string, fields: Record<string, string>): Promise<void> {
  const { data } = await call<{ csrfToken: string }>('GET', 'auth/csrf');
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = serverUrl('auth/' + action);
  form.style.display = 'none';
  for (const [k, v] of Object.entries({ ...fields, csrfToken: data?.csrfToken ?? '' })) {
    const i = document.createElement('input');
    i.type = 'hidden'; i.name = k; i.value = v;
    form.appendChild(i);
  }
  document.body.appendChild(form);
  form.submit();
}
export const signIn = (provider: string, callbackUrl = location.href): Promise<void> => authPost('signin/' + provider, { callbackUrl });
export const signOut = (callbackUrl = location.href): Promise<void> => authPost('signout', { callbackUrl });

/** The OAuth redirect (callback) URL to register with a provider, for the wizard. */
export const callbackUrl = (provider: string): string => serverUrl('auth/callback/' + provider);

export const httpSync: SyncApi = {
  async getLibrary(): Promise<RemoteLibrary | null> {
    const { status: s, data } = await call<RemoteLibrary>('GET', 'api/library');
    return s === 204 ? null : data;
  },
  async putLibrary(baseRev: number, doc: MockBackup): Promise<PushResult> {
    const { status: s, data } = await call<{ rev: number; updatedAt: string; current?: RemoteLibrary | null }>('PUT', 'api/library', { baseRev, doc });
    if (s === 409) return { ok: false, current: data?.current ?? null };
    return { ok: true, rev: data!.rev, updatedAt: data!.updatedAt };
  },
};
