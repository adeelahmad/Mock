# Sync with a passphrase

Sync your library between your own devices with no account and no server, including the copy of
Mock on GitHub Pages. Choose a passphrase once. Type it on each device, or pair a new device
with a short code. After that, every change you make shows up on your other open devices within
a second or two, end-to-end encrypted.

It sits next to [Sign-in and sync](/guide/sync), which uses the Mock server. Use either one, or both.

## Turn it on

1. **Settings → Sync → Sync with a passphrase → Turn on.**
2. Type a passphrase, or press **Generate one** for eight random words (64 bits). Write it
   down. Mock never stores it, and nobody can recover it for you.
3. Leave **Sync my Gemini key too** on if you want the key on your other devices as well. It is
   encrypted like everything else.
4. On your other device, do the same with the same passphrase, or use a pairing code.

The status line shows how many of your devices are connected right now.

## Pair a new device with a code

Typing a long passphrase on a phone is painful, so pairing works like
[Magic Wormhole](https://magic-wormhole.readthedocs.io/):

1. On a device that already syncs: **Settings → Sync → Pair a device.** It shows a code such
   as `42-violet-anchor` and a QR code.
2. On the new device, either scan the QR code, which opens Mock with the code filled in, or open
   **Settings → Sync → Turn on → Pair with a code** and type it.

The code works once and expires after ten minutes. A wrong guess uses it up, so someone watching
can't keep trying codes. Pairing hands over the vault key and the relay settings, never the
passphrase.

## What syncs

| Syncs | Stays on each device |
|---|---|
| Stories, questions, prep files (their text), areas | Session recordings and answer clips |
| Sessions, answers, coaching, transcripts | Uploaded original files (PDF, DOCX…) |
| Settings, spend ledger, game rounds | Appearance and layout preferences |
| The Gemini key (if you leave it on) | |

Recordings are too large for a live channel. Move them with **Back up everything** when you
need them.

## Where devices meet

Before two browsers can talk directly, they have to find each other through a relay. The relay
only passes short hello, offer and answer messages, and they are encrypted with your vault key.
Pick the relay in **Settings → Sync → Where devices meet**:

- **Public relays** (the default on GitHub Pages): free public [Nostr](https://nostr.com)
  relays. Nothing to host or sign up for.
- **This server**: when Mock is served by your own [Mock server](/run/install) and you are
  signed in to it. Only signed-in users can use it, and each account only sees its own devices.
- **My Mock server / Another server**: use your self-hosted Mock from somewhere else, for example
  the GitHub Pages app talking to the Mock in your home lab. Press **Sign in**, sign in once in
  the window that opens with GitHub, Google or OIDC, and the window hands a relay token back.
  The server only gives tokens to app addresses listed in `MOCK_SIGNAL_ORIGINS`, which allows
  `https://adeelahmad.github.io` by default.

### Self-hosted behind a Cloudflare Tunnel

To keep your server private but still reachable, publish it with a
[Cloudflare Tunnel](/run/proxmox#cloudflare-tunnel): no open ports, HTTPS from Cloudflare, and
sign-in through your OAuth providers. The relay works through the tunnel because it is an
ordinary WebSocket. Your library still goes device to device and never through the server.

## How it works

```
passphrase ──Argon2id (64 MiB, 3 passes)──▶ master key ──HKDF──▶ room tag · AES-GCM key
                                                  │
       device library (DuckDB) ◀──bridge──▶ Yjs CRDT document (IndexedDB)
                                                  │  updates, AES-GCM sealed
             relay (Nostr / Mock /signal) ◀─ hello · offer · answer (sealed) ─▶ WebRTC data channel ─▶ other devices
```

- **Keys.** Argon2id turns the passphrase into a 32-byte master key in the browser. The salt
  is derived from the passphrase, because there is no server to keep a random one, so the same
  passphrase finds the same vault everywhere. The master key is kept on the device so you don't
  retype the passphrase. **Turn off on this device** forgets it.
- **Merge.** The library is mirrored into a [Yjs](https://yjs.dev) CRDT, one entry per row and
  per setting. Edits made on different devices, even offline, merge the same way everywhere:
  rows added on either side are kept, a row deleted on one device is deleted on all of them,
  and when two devices change the same row, one complete version wins (no half-merged rows).
  If two devices each start with the built-in question bank, they end up with one copy.
- **Transport.** Devices connect directly over WebRTC data channels. Public STUN servers help
  them get through home routers. Every message is sealed with AES-GCM using the vault key, on
  top of WebRTC's own DTLS encryption.

## Honest limits

- **Your devices must be online at the same time.** There is no server copy. A change made on
  your phone reaches your laptop the next time both are open together. Each device keeps the
  full library, so nothing is lost while you wait.
- **The passphrase is the account.** Anyone with it can join your vault, so a weak passphrase
  can be guessed offline. Mock refuses short ones; a generated one is best.
- **Some networks block direct connections.** Some mobile carriers and corporate networks
  don't allow peer-to-peer connections. Add a TURN server in **Where devices meet**
  (`turn:user:pass@turn.example.com:3478`). A Cloudflare Tunnel can't carry TURN, because TURN
  needs its own UDP port.
- **Public relays are public.** They see an anonymous topic, encrypted messages and your IP
  address, as any website you visit does. Use your own Mock server as the relay to avoid them.
- **Conflicts are per row.** If two devices edit the same story while apart, one version of
  that story wins. Different stories, settings and sessions all merge.
- **Recordings don't sync** (see the table above).
