#!/usr/bin/env bash
# Mock: boots a built LXC template under systemd-nspawn and checks that first boot brought up the
# mock service and Caddy, and that the app answers over HTTPS. Needs root and systemd-nspawn
# (apt install systemd-container). The container gets its own network namespace (loopback only).
#
#   sudo proxmox/lxc/smoke.sh bin/mock-lxc-debian13-amd64.tar.zst
set -euo pipefail
TEMPLATE="${1:?usage: smoke.sh <template.tar.zst>}"
NAME="mock-smoke-$$"
DIR="$(mktemp -d)"
LOG="$DIR.log"
cleanup() {
  machinectl terminate "$NAME" >/dev/null 2>&1 || true
  sleep 2
  rm -rf "$DIR"
}
trap cleanup EXIT

tar --zstd --numeric-owner -xpf "$TEMPLATE" -C "$DIR"
systemd-nspawn --boot --quiet --private-network --machine="$NAME" -D "$DIR" </dev/null >"$LOG" 2>&1 &

run() { systemd-run --quiet --machine="$NAME" --wait --pipe "$@"; }
for _ in $(seq 60); do
  run /bin/true 2>/dev/null && [[ "$(run systemctl is-active mock-firstboot 2>/dev/null)" == active ]] && break
  sleep 2
done
diagnose() {
  run sh -c 'id caddy; ls -laRn /var/lib/caddy | head -40; journalctl --no-pager -b -n 60' || true
  dmesg 2>/dev/null | grep -iE 'apparmor|denied' | tail -20 || true
  exit 1
}
run systemctl --no-pager status mock-firstboot mock caddy || diagnose
for _ in $(seq 15); do run curl -fsk -o /dev/null https://localhost/ 2>/dev/null && break; sleep 2; done
run curl -fsSk https://localhost/ | grep -qi '<title>' || { echo "smoke: https://localhost/ did not serve the app" >&2; diagnose; }
run curl -fsS http://localhost/ -o /dev/null
run sh -c 'ls /etc/ssh/ssh_host_ed25519_key && mock-token >/dev/null && echo "mock-token ok"'
echo "smoke: $(basename "$TEMPLATE") booted; mock, Caddy and HTTPS are up"
