// Mock — pairing a new device with a short code, the way Magic Wormhole does it. The device that
// already has the vault shows a code ("42-violet-anchor") and a QR code; the new device types or
// scans it. A password-authenticated key exchange (CPace-style, on ristretto255) turns the short
// code into a strong one-time key, and the vault key travels sealed under it. Someone watching the
// relay learns nothing; someone guessing the code gets one try before the code is spent.
//
//   new device (joiner)                      existing device (host)
//   ─ pake  Yj = G·y ───────────────────────▶
//   ◀──────────────────────────── pake  Xh = G·x
//   ─ confirm HMAC(k, "joiner") ────────────▶  checks it (a wrong code stops here)
//   ◀──────────────── key  seal(k, payload)
//
// G is hashed from the code; k = HKDF(G·xy, both public values). The nameplate (the number)
// picks the rendezvous topic; the words are the password.

import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { fromB64, open, seal, toB64 } from './keys.ts';
import type { Signal } from './signal.ts';
import { WORDS } from './words.ts';

export interface PairCode { nameplate: number; words: [string, string] }
type Msg = { s: string; t: 'pake'; p: string } | { s: string; t: 'confirm'; m: string } | { s: string; t: 'key'; c: string } | { s: string; t: 'fail' };

export const formatCode = (c: PairCode): string => c.nameplate + '-' + c.words.join('-');
export function parseCode(raw: string): PairCode | null {
  const parts = raw.trim().toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (parts.length !== 3 || !/^\d{1,3}$/.test(parts[0])) return null;
  const [n, a, b] = parts;
  if (!WORDS.includes(a) || !WORDS.includes(b)) return null;
  return { nameplate: Number(n), words: [a, b] };
}
export function newCode(): PairCode {
  const r = crypto.getRandomValues(new Uint16Array(3));
  return { nameplate: 1 + (r[0] % 999), words: [WORDS[r[1] % 256], WORDS[r[2] % 256]] };
}

export const pairTopic = (nameplate: number): string => bytesToHex(sha256(utf8ToBytes('mock-pair/v1/' + nameplate)));
const generator = (c: PairCode) => ristretto255_hasher.hashToCurve(utf8ToBytes(formatCode(c)), { DST: 'mock-pair-v1-cpace' });
const scalar = () => ristretto255_hasher.hashToScalar(crypto.getRandomValues(new Uint8Array(64)), { DST: 'mock-pair-v1-scalar' });

/** One side of the exchange: its public value, and the shared key once it sees the other's. */
function side(code: PairCode) {
  const g = generator(code);
  const x = scalar();
  const pub = g.multiply(x).toBytes();
  return {
    pub,
    async shared(other: Uint8Array, joinerPub: Uint8Array, hostPub: Uint8Array): Promise<{ k: Uint8Array; aes: CryptoKey }> {
      const P = ristretto255.Point.fromBytes(other);
      if (P.is0()) throw new Error('bad pairing value');
      const z = P.multiply(x).toBytes();
      const k = hkdf(sha256, z, concatBytes(joinerPub, hostPub), utf8ToBytes('mock-pair/v1/key'), 32);
      const aes = await crypto.subtle.importKey('raw', hkdf(sha256, k, undefined, utf8ToBytes('mock-pair/v1/aes'), 32) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
      return { k, aes };
    },
  };
}

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.reduce((d, x, i) => d | (x ^ b[i]), 0) === 0;
const session = (): string => bytesToHex(crypto.getRandomValues(new Uint8Array(8)));

export interface Pairing<T> { code: PairCode; done: Promise<T>; cancel(): void }

/**
 * Host: wait for one device to present the code, then send it `payload`. Single use: after one
 * attempt (right or wrong) the code is spent. Resolves true when the other device took the key.
 */
export function host(signal: Signal, payload: Uint8Array, o: { code?: PairCode; timeoutMs?: number } = {}): Pairing<boolean> {
  const code = o.code ?? newCode();
  const topic = pairTopic(code.nameplate);
  const me = session();
  let leave = () => {};
  let timer: ReturnType<typeof setTimeout>;
  let peer: string | null = null;
  let finish!: (v: boolean) => void, fail!: (e: Error) => void;
  const done = new Promise<boolean>((res, rej) => { finish = res; fail = rej; });
  const s = side(code);
  let joinerPub: Uint8Array | null = null;
  let shared: { k: Uint8Array; aes: CryptoKey } | null = null;
  const send = (m: Omit<Msg, 's'> & Record<string, string>) => signal.publish(topic, JSON.stringify({ ...m, s: me }));
  const end = (e?: Error) => { clearTimeout(timer); leave(); if (e) fail(e); };
  leave = signal.join(topic, (raw) => void (async () => {
    let m: Msg;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.s === me) return;
    if (m.t === 'pake' && !peer) {
      peer = m.s;
      try {
        joinerPub = hexToBytes(m.p);
        shared = await s.shared(joinerPub, joinerPub, s.pub);
        send({ t: 'pake', p: bytesToHex(s.pub) });
      } catch { end(new Error('Pairing failed')); }
    } else if (m.t === 'confirm' && m.s === peer && shared) {
      const want = hmac(sha256, shared.k, utf8ToBytes('joiner'));
      if (!equalBytes(want, hexToBytes(m.m))) { send({ t: 'fail' }); end(new Error('Wrong code: the other device typed a different one')); return; }
      send({ t: 'key', c: toB64(await seal(shared.aes, payload, 'pair')) });
      end(); finish(true);
    }
  })());
  timer = setTimeout(() => end(new Error('The code expired')), o.timeoutMs ?? 10 * 60_000);
  return { code, done, cancel: () => end(new Error('cancelled')) };
}

/** Joiner: present the code; resolves with the host's payload. */
export function join(signal: Signal, code: PairCode, o: { timeoutMs?: number; retryMs?: number } = {}): Pairing<Uint8Array> {
  const topic = pairTopic(code.nameplate);
  const me = session();
  const s = side(code);
  let host: string | null = null;
  let shared: { aes: CryptoKey } | null = null;
  let finish!: (v: Uint8Array) => void, fail!: (e: Error) => void;
  const done = new Promise<Uint8Array>((res, rej) => { finish = res; fail = rej; });
  const send = (m: Record<string, string>) => signal.publish(topic, JSON.stringify({ ...m, s: me }));
  const hello = () => send({ t: 'pake', p: bytesToHex(s.pub) });
  // The host may not be listening yet (or the relay dropped it): say it again until answered.
  const again = setInterval(() => { if (!host) hello(); }, o.retryMs ?? 3000);
  const end = (e?: Error) => { clearInterval(again); clearTimeout(timer); leave(); if (e) fail(e); };
  const leave = signal.join(topic, (raw) => void (async () => {
    let m: Msg;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.s === me) return;
    if (m.t === 'pake' && !host) {
      host = m.s;
      try {
        const hostPub = hexToBytes(m.p);
        const sh = await s.shared(hostPub, s.pub, hostPub);
        shared = sh;
        send({ t: 'confirm', m: bytesToHex(hmac(sha256, sh.k, utf8ToBytes('joiner'))) });
      } catch { end(new Error('Pairing failed')); }
    } else if (m.t === 'fail' && m.s === host) {
      end(new Error('Wrong code'));
    } else if (m.t === 'key' && m.s === host && shared) {
      const p = await open(shared.aes, fromB64(m.c), 'pair');
      if (!p) { end(new Error('Wrong code')); return; }
      end(); finish(p);
    }
  })());
  const timer = setTimeout(() => end(new Error('No device answered that code')), o.timeoutMs ?? 2 * 60_000);
  hello();
  return { code, done, cancel: () => end(new Error('cancelled')) };
}
