# Proxmox VE

On the Proxmox host shell:

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/adeelahmad/Mock/main/proxmox/ct/mock.sh)"
```

It asks how to make the container:

- **Prebuilt** (fast): downloads the release's LXC template and runs `pct create`. Nothing is
  built on the host or in the container.
- **From source**: the [community-scripts](https://community-scripts.github.io/ProxmoxVE/)
  helper wizard, which builds Mock in the container.

`MOCK_MODE=template` or `MOCK_MODE=source` skips the question.

## Prebuilt template

Each release carries `mock-lxc-debian13-amd64.tar.zst` and `mock-lxc-debian13-arm64.tar.zst`:
a Debian 13 rootfs (built with mmdebstrap) holding the [Mock binary](/run/go-binary), Caddy,
OpenSSH and a `mock-firstboot` unit. On every boot it writes the Caddyfile for the container's
hostname and IPs; the first boot also creates the `mock` user, service and `/var/lib/mock`, and
fresh SSH host keys. The script verifies the download against the release's `checksums.txt`.

Template options, as environment variables on the script:

| Variable | Default |
|---|---|
| `CTID` | next free id |
| `MOCK_HOSTNAME` | `mock` |
| `MOCK_STORAGE` | `local-lvm` (root disk) |
| `MOCK_TEMPLATE_STORAGE` | `local` (where the template is cached) |
| `MOCK_DISK`, `MOCK_CORES`, `MOCK_RAM` | `8` GB, `2`, `2048` MiB |
| `MOCK_BRIDGE` | `vmbr0` (DHCP) |
| `MOCK_TAG` | latest release |
| `MOCK_SSH_KEYS` | a public key file for root |

Or by hand:

```sh
wget -P /var/lib/vz/template/cache \
  https://github.com/adeelahmad/Mock/releases/latest/download/mock-lxc-debian13-amd64.tar.zst
pct create 120 local:vztmpl/mock-lxc-debian13-amd64.tar.zst --hostname mock --ostype debian \
  --unprivileged 1 --features nesting=1 --cores 2 --memory 2048 --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp --onboot 1 --start 1
pct exec 120 -- mock-token
```

Root has no password; set one with `pct exec 120 -- passwd`. Inside the container, `update`
installs the latest release's binary (`MOCK_TAG=v0.2.0 update` for a given one) and restarts the
service; `/var/lib/mock` stays.

To build the templates yourself: `make lxc` (needs mmdebstrap; run as root or with subuids;
arm64 on an amd64 host needs qemu-user-static). `sudo proxmox/lxc/smoke.sh <template>` boots one
under systemd-nspawn and checks the app answers over HTTPS. Tagged releases build both,
smoke-test them and attach them.

## From source

### What you get

- The usual helper-script wizard (Default / Advanced, `var_*` overrides).
- An unprivileged Debian 13 container: 2 vCPU, 2 GiB RAM, 8 GB disk.
- Caddy, and the [Mock binary](/run/go-binary) built in the container (Node 22 and Go for the
  build) into `/usr/local/bin/mock`, running as the `mock` service behind Caddy.
- SQLite in `/var/lib/mock`. For Postgres or a public `AUTH_URL`, edit `/etc/mock/server.env`.
- Served on `https://<ip>/` with Caddy's internal CA, and on `http://<ip>/`. Trust the root
  certificate printed at the end, since the microphone needs trusted HTTPS.

### Inside the container

| Command | Does |
|---|---|
| `update` | pull `main` and rebuild the binary |
| `mock-token` | print the sign-in setup token |
| `systemctl status mock` | server status |
