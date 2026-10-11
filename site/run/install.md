<script setup>
import { withBase } from 'vitepress'
</script>

# Install

Mock ships as **one binary**: the web app is embedded in it, and the same file is the
[sign-in and sync](/guide/sync) server and the [Google Meet](/guide/meet) bridge. It is pure Go
(SQLite included), so it runs with nothing else installed: no Node, no Go, no npm. Only the
Meet bot needs a Chrome or Chromium beside it.

Not installing anything at all? Use the <a :href="withBase('/app/')" target="_self">hosted app</a> and add
it to your home screen.

## Download

Linux and macOS, amd64 and arm64:

```sh
curl -fsSL https://raw.githubusercontent.com/adeelahmad/Mock/main/install.sh | sh
mock               # then open http://localhost:8787
```

The script downloads the binary for your machine from the
[latest release](https://github.com/adeelahmad/Mock/releases/latest), checks it against the
release's `checksums.txt` and puts it in `/usr/local/bin` (or `~/.local/bin`).
`MOCK_VERSION=v0.1.0` pins a release; `MOCK_INSTALL_DIR` picks where it goes.

Or download it by hand: grab `mock-<os>-<arch>` from the release, `chmod +x` it and run it.

On Proxmox VE there is a prebuilt LXC template with Mock, Caddy and the services inside; see
[Proxmox](/run/proxmox).

## Run

```sh
mock                 # the app + sign-in + sync on http://localhost:8787
mock --meet          # … plus the Meet bridge (ws://127.0.0.1:8788 and the main port)
mock token           # print the setup token the sign-in wizard asks for
mock bridge          # only the Meet bridge, for the app hosted elsewhere
mock help
```

Copy it anywhere and run it. Data goes to `data/mock.db` where it runs (`MOCK_DB` to move it,
`DATABASE_URL` for Postgres). Put HTTPS in front of it for anything but localhost: the
microphone and service worker need a secure origin. Settings are the
[server settings](/guide/sync#server-settings), as environment variables or flags
(`--port`, `--host`, `--meet`, `--bridge-port`, `--headed`, `--profile`).

| Command | Flags | Does |
|---|---|---|
| `mock` / `mock serve` | `--port`, `--host`, `--meet`, `--bridge-port`, `--headed`, `--profile` | the app, sign-in and sync; with `--meet` the Meet bridge too |
| `mock token` | | print the sign-in setup token |
| `mock bridge` | `--port`, `--headed`, `--profile` | only the Meet bridge on 127.0.0.1 |
| `mock version` | | the build's version (`git describe`) |

## Run it as a service

On a Linux server, with the binary in `/usr/local/bin/mock`:

```ini
# /etc/systemd/system/mock.service
[Unit]
Description=Mock
After=network-online.target

[Service]
ExecStart=/usr/local/bin/mock --host 127.0.0.1
Environment=MOCK_DB=/var/lib/mock/mock.db
Environment=AUTH_URL=https://mock.example.com
DynamicUser=yes
StateDirectory=mock
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now mock
sudo MOCK_DB=/var/lib/mock/mock.db mock token   # the setup token for the wizard
```

Then put HTTPS in front, for example with Caddy:

```
mock.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

The [Proxmox](/run/proxmox) container does all of this for you.

## Build from source

Only for contributors, or a platform without a release binary (Windows, say). Building needs
Node 22 and Go 1.26 or newer; the result runs without either.

```sh
git clone https://github.com/adeelahmad/Mock && cd Mock
make binary        # bin/mock for this machine
make binaries      # bin/mock-{linux,darwin}-{amd64,arm64}
```

See [Build from source](/run/develop) for the rest of the Makefile.
