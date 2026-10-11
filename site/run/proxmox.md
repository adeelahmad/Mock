# Proxmox VE

On the Proxmox host shell:

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/adeelahmad/Mock/main/proxmox/ct/mock.sh)"
```

It asks how to make the container:

- **Prebuilt** (fast): downloads the release's LXC template and runs `pct create`. Nothing is
  built on the host or in the container.
- **Wizard**: the [community-scripts](https://community-scripts.github.io/ProxmoxVE/)
  helper wizard, which makes a fresh container and downloads the release's binary into it.

Neither needs Node or Go. `MOCK_MODE=template` or `MOCK_MODE=source` (the wizard) skips the
question.

::: warning Until the first release
Both paths download from a GitHub Release. Until v0.1.0 is tagged there is none: the script
then uses the wizard, which builds Mock from source in the container (Node 22 and Go, removed
again afterwards).
:::

## Prebuilt template

Each release carries `mock-lxc-debian13-amd64.tar.zst` and `mock-lxc-debian13-arm64.tar.zst`:
a Debian 13 rootfs (built with mmdebstrap) holding the [Mock binary](/run/install), Caddy,
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

## Cloudflare Tunnel

Keep the container private and still reach it from anywhere: a
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
connects out to Cloudflare, so nothing listens on your public IP, and Cloudflare serves HTTPS
with a real certificate, so phones don't need Caddy's root certificate either.

1. In Cloudflare Zero Trust, go to **Networks → Tunnels → Create a tunnel → Cloudflared**, then
   copy the token.
2. Add a **public hostname** such as `mock.example.com`, with service `http://localhost:8787`.
3. Run it in the container:

   ```sh
   pct exec 120 -- mock-tunnel <tunnel-token> mock.example.com
   ```

   It installs `cloudflared` as a service and sets `AUTH_URL=https://mock.example.com` in
   `/etc/mock/server.env`, so sign-in callbacks use the public address. The prebuilt-template
   installer also asks for the token (`MOCK_CF_TOKEN` and `MOCK_CF_HOSTNAME` skip the question).
4. Register your OAuth apps with `https://mock.example.com/auth/callback/<provider>`.

Then use `https://mock.example.com` from any device. Sign in, and
[passphrase sync](/guide/passphrase-sync) uses this server as its relay (signed-in users only).
The GitHub Pages app can use it too: **Settings → Sync → Where devices meet → My Mock server**.
A tunnel carries HTTP and WebSockets but not TURN (UDP). Most devices connect directly anyway;
for the networks that don't, run a TURN server with its own UDP port.

## Helper wizard

### What you get

- The usual helper-script wizard (Default / Advanced, `var_*` overrides).
- An unprivileged Debian 13 container: 2 vCPU, 2 GiB RAM, 8 GB disk.
- Caddy, and the release's [Mock binary](/run/install) in `/usr/local/bin/mock` (built from
  source only while no release exists), running as the `mock` service behind Caddy.
- SQLite in `/var/lib/mock`. For Postgres or a public `AUTH_URL`, edit `/etc/mock/server.env`.
- Served on `https://<ip>/` with Caddy's internal CA, and on `http://<ip>/`. Trust the root
  certificate printed at the end, since the microphone needs trusted HTTPS.

### Inside the container

| Command | Does |
|---|---|
| `update` | install the latest release's binary |
| `mock-token` | print the sign-in setup token |
| `mock-tunnel <token> [hostname]` | publish through a [Cloudflare Tunnel](#cloudflare-tunnel) |
| `systemctl status mock` | server status |
