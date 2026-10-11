# Go binary

`bin/mock` is the whole app in one file: the built web app is embedded in it, and the same
binary is the [sign-in and sync](/guide/sync) server and the [Google Meet](/guide/meet) bridge.
It is pure Go (SQLite included), so it runs with nothing else installed. Only the Meet bot needs
a Chrome or Chromium beside it.

## Build

Needs Node 22 and Go 1.24 or newer to build (not to run).

```sh
make binary        # bin/mock for this machine
make binaries      # bin/mock-{linux,darwin}-{amd64,arm64}
```

## Run

```sh
./bin/mock                 # the app + sign-in + sync on http://localhost:8787
./bin/mock --meet          # … plus the Meet bridge (ws://127.0.0.1:8788 and the main port)
./bin/mock token           # print the setup token the sign-in wizard asks for
./bin/mock bridge          # only the Meet bridge, for the app hosted elsewhere
./bin/mock help
```

Copy it anywhere and run it. Data goes to `data/mock.db` where it runs (`MOCK_DB` to move it,
`DATABASE_URL` for Postgres). Put HTTPS in front of it for anything but localhost: the
microphone and service worker need a secure origin. Settings are the
[server settings](/guide/sync#server-settings), as environment variables or flags
(`--port`, `--host`, `--meet`, `--bridge-port`, `--headed`, `--profile`).
