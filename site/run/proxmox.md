# Proxmox VE

A [community-scripts](https://community-scripts.github.io/ProxmoxVE/) helper script that uses
their engine. On the Proxmox host shell:

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/adeelahmad/Mock/main/proxmox/ct/mock.sh)"
```

While the repo is private, either clone it on the host and run `bash proxmox/ct/mock.sh`, or
`export MOCK_GITHUB_TOKEN=<read-only token>` and add
`-H "Authorization: Bearer $MOCK_GITHUB_TOKEN"` to the curl. The token is kept in the
container's git remote so `update` can pull.

## What you get

- The usual helper-script wizard (Default / Advanced, `var_*` overrides).
- An unprivileged Debian 13 container: 2 vCPU, 2 GiB RAM, 8 GB disk.
- Node 22 and Caddy; the app is built and the Mock server runs as the `mock-server` service.
- SQLite in `/var/lib/mock`. For Postgres or a public `AUTH_URL`, edit `/etc/mock/server.env`.
- Served on `https://<ip>/` with Caddy's internal CA, and on `http://<ip>/`. Trust the root
  certificate printed at the end, since the microphone needs trusted HTTPS.

## Inside the container

| Command | Does |
|---|---|
| `update` | pull `main` and rebuild |
| `mock-token` | print the sign-in setup token |
| `systemctl status mock-server` | server status |
