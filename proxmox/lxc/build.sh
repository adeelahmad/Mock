#!/usr/bin/env bash
# Mock: builds a prebuilt Proxmox VE LXC template (Debian 13 rootfs, .tar.zst) with mmdebstrap.
#
#   proxmox/lxc/build.sh <amd64|arm64> [path/to/mock-linux-<arch>]
#   make lxc                      # both architectures, into bin/
#
# The template holds the Mock binary (web app embedded), Caddy (`tls internal`, from Debian),
# OpenSSH, and mock-firstboot.service, which on every boot runs mock-server.sh: it creates the
# mock user and service, writes the Caddyfile for the container's hostname and IPs, and makes
# fresh SSH host keys the first time. Nothing is configured until the container boots.
#
# Runs as root, or as a user with subuids (mmdebstrap's unshare mode). A foreign architecture
# needs qemu-user-static with binfmt_misc registered. Extra mmdebstrap flags: MMDEBSTRAP_ARGS.
set -euo pipefail

ARCH="${1:-$(dpkg --print-architecture 2>/dev/null || echo amd64)}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="${2:-$ROOT/bin/mock-linux-$ARCH}"
OUT="${OUT:-$ROOT/bin}"
SUITE="${SUITE:-trixie}"
MIRROR="${MIRROR:-http://deb.debian.org/debian}"
VERSION="${VERSION:-$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo dev)}"
# Release asset name: stable, so ct/mock.sh can fetch .../releases/latest/download/<name>.
NAME="mock-lxc-debian13-${ARCH}.tar.zst"

case "$ARCH" in amd64 | arm64) ;; *) echo "build.sh: arch must be amd64 or arm64" >&2; exit 2 ;; esac
[[ -x "$BIN" ]] || { echo "build.sh: no binary at $BIN (run: make binaries)" >&2; exit 1; }
command -v mmdebstrap >/dev/null || { echo "build.sh: needs mmdebstrap (apt install mmdebstrap)" >&2; exit 1; }
mkdir -p "$OUT"

PACKAGES=(
  systemd systemd-sysv dbus ifupdown isc-dhcp-client iproute2 iputils-ping
  ca-certificates curl openssh-server caddy less nano procps tzdata locales
)

# shellcheck disable=SC2086
mmdebstrap \
  --variant=apt \
  --architectures="$ARCH" \
  --format=tar \
  --skip=output/dev \
  --include="$(IFS=,; echo "${PACKAGES[*]}")" \
  --customize-hook='mkdir -p "$1/usr/local/lib/mock"' \
  --customize-hook="upload '$BIN' /usr/local/bin/mock" \
  --customize-hook="upload '$ROOT/proxmox/install/mock-server.sh' /usr/local/lib/mock/mock-server.sh" \
  --customize-hook="upload '$ROOT/proxmox/banner.sh' /usr/local/lib/mock/banner.sh" \
  --customize-hook="sync-in '$ROOT/proxmox/lxc/rootfs' /" \
  --customize-hook='chroot "$1" chown -R root:root /usr/local/bin/mock /usr/local/lib/mock /etc/systemd/system/mock-firstboot.service /etc/profile.d/mock.sh /usr/bin/update' \
  --customize-hook='chmod 0755 "$1/usr/local/bin/mock" "$1/usr/local/lib/mock/mock-server.sh" "$1/usr/local/lib/mock/mock-firstboot" "$1/usr/bin/update"' \
  --customize-hook='chroot "$1" systemctl enable mock-firstboot.service' \
  --customize-hook="echo '$VERSION' >\"\$1/etc/mock-release\"" \
  --customize-hook='rm -f "$1"/etc/ssh/ssh_host_*' \
  --customize-hook='sed -i "s/^# *en_US.UTF-8/en_US.UTF-8/" "$1/etc/locale.gen" && chroot "$1" locale-gen >/dev/null' \
  --customize-hook='rm -rf "$1"/var/cache/apt/*.bin "$1"/var/log/*.log "$1"/usr/share/doc/* "$1"/usr/share/man/*' \
  ${MMDEBSTRAP_ARGS:-} \
  "$SUITE" - "$MIRROR" | zstd -19 -T0 -q -f -o "$OUT/$NAME"

(cd "$OUT" && sha256sum "$NAME" >"$NAME.sha256")
ls -lh "$OUT/$NAME"
