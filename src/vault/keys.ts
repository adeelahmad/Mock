// Mock — vault keys. A passphrase is the whole account: the browser stretches it with Argon2id
// into a 32-byte master key, and everything else comes from that master with HKDF:
//
//   room   the rendezvous tag peers meet under on the signaling relays (reveals nothing)
//   enc    AES-GCM key for everything that leaves the device (signaling and peer messages)
//
// The salt is derived from the passphrase itself (there is no server to keep a random one), so
// the same passphrase finds the same vault on every device. That makes the passphrase the only
// secret: it must be strong, which is why the app offers a generated one. The passphrase is never
// stored; the master key is kept on the device (and handed to a new device by pairing).

import { argon2idAsync } from '@noble/hashes/argon2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { WORDS } from './words.ts';

export interface KdfParams { t: number; m: number; p: number }
/** Argon2id, 64 MiB, 3 passes: about a second on a laptop, a few on a phone, once per device. */
export const KDF: KdfParams = { t: 3, m: 65536, p: 1 };

export interface VaultKeys {
  /** The master key (32 bytes). Everything else derives from it. */
  master: Uint8Array;
  /** Short public id: names the local CRDT store and shows in Settings. */
  id: string;
  /** Rendezvous tag on the signaling relays. */
  room: string;
  enc: CryptoKey;
}

export const normalizePassphrase = (p: string): string => p.normalize('NFKC').trim().replace(/\s+/g, ' ');

/** Rough strength: bits for a generated-looking word list, else by character classes. */
export function passphraseBits(p: string): number {
  const s = normalizePassphrase(p);
  const words = s.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2 && words.every((w) => WORDS.includes(w))) return words.length * 8;
  let pool = 0;
  if (/[a-z]/.test(s)) pool += 26;
  if (/[A-Z]/.test(s)) pool += 26;
  if (/[0-9]/.test(s)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(s)) pool += 33;
  // People pick words, not random characters: count half.
  return Math.round((s.length * Math.log2(pool || 1)) / 2);
}
export const MIN_BITS = 48;

const randomIndex = (n: number): number => crypto.getRandomValues(new Uint32Array(1))[0] % n;
/** A fresh passphrase: `words` random words from the 256-word list (8 bits each). */
export const generatePassphrase = (words = 8): string => Array.from({ length: words }, () => WORDS[randomIndex(WORDS.length)]).join(' ');

/** Argon2id(passphrase, salt = SHA-256("mock-vault/v1/salt" ‖ passphrase)[0..16]). */
export async function deriveMaster(passphrase: string, params: KdfParams = KDF): Promise<Uint8Array> {
  const p = utf8ToBytes(normalizePassphrase(passphrase));
  const salt = sha256(new Uint8Array([...utf8ToBytes('mock-vault/v1/salt\0'), ...p])).slice(0, 16);
  return argon2idAsync(p, salt, { ...params, dkLen: 32, asyncTick: 25 });
}

const sub = (master: Uint8Array, info: string, len = 32): Uint8Array => hkdf(sha256, master, undefined, utf8ToBytes('mock-vault/v1/' + info), len);

export async function keysFrom(master: Uint8Array): Promise<VaultKeys> {
  const enc = await crypto.subtle.importKey('raw', sub(master, 'enc') as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { master, id: bytesToHex(sub(master, 'id', 6)), room: bytesToHex(sub(master, 'room', 32)), enc };
}

// ------------------------------------------------------------------ sealing

/** iv(12) ‖ AES-GCM(ciphertext + tag). `purpose` is bound as associated data. */
export async function seal(key: CryptoKey, data: Uint8Array, purpose: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: utf8ToBytes(purpose) as BufferSource }, key, data as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0); out.set(ct, 12);
  return out;
}

/** null when the data was not sealed with this key and purpose (wrong vault, tampered). */
export async function open(key: CryptoKey, data: Uint8Array, purpose: string): Promise<Uint8Array | null> {
  if (data.length < 28) return null;
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) as BufferSource, additionalData: utf8ToBytes(purpose) as BufferSource }, key, data.slice(12) as BufferSource));
  } catch { return null; }
}

export const toB64 = (b: Uint8Array): string => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
