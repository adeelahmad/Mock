#!/usr/bin/env bash
# Mock — Proxmox VE LXC installer, in the style of the community "Proxmox VE Helper-Scripts".
#
# On the Proxmox host shell:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/adeelahmad/Mock/main/proxmox/ct/mock.sh)"
#
# Creates an unprivileged Debian 12 LXC, installs Node 22 and Caddy, builds the static app and
# serves it on :80 and :443 (Caddy's internal CA; the microphone needs HTTPS).
# Run the same command inside the container, or just `update` there, to update.
#
# Non-interactive: set any var_* below in the environment and MOCK_DEFAULTS=1, e.g.
#   var_ctid=120 var_ram=4096 MOCK_DEFAULTS=1 bash -c "$(curl -fsSL …/mock.sh)"
set -Eeuo pipefail

APP="Mock"
REPO_URL="${MOCK_REPO:-https://github.com/adeelahmad/Mock.git}"
BRANCH="${MOCK_BRANCH:-main}"
RAW_BASE="${MOCK_RAW:-https://raw.githubusercontent.com/adeelahmad/Mock/${BRANCH}}"

var_os="${var_os:-debian}"
var_version="${var_version:-12}"
var_hostname="${var_hostname:-mock}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-2048}"
var_disk="${var_disk:-8}"
var_bridge="${var_bridge:-vmbr0}"
var_net="${var_net:-dhcp}"          # dhcp or CIDR, e.g. 192.168.1.50/24
var_gateway="${var_gateway:-}"
var_unprivileged="${var_unprivileged:-1}"

YW=$'\033[33m'; GN=$'\033[1;92m'; RD=$'\033[01;31m'; BL=$'\033[36m'; CL=$'\033[m'
msg_info() { printf ' %s⏳ %s...%s\n' "$YW" "$1" "$CL"; }
msg_ok()   { printf ' %s✔ %s%s\n' "$GN" "$1" "$CL"; }
msg_error(){ printf ' %s✖ %s%s\n' "$RD" "$1" "$CL" >&2; }
trap 'msg_error "Failed at line $LINENO: $BASH_COMMAND"' ERR

header() {
  cat <<'ART'
    __  ___           __
   /  |/  /___  _____/ /__
  / /|_/ / __ \/ ___/ //_/
 / /  / / /_/ / /__/ ,<
/_/  /_/\____/\___/_/|_|   Proxmox VE LXC
ART
}

# Inside an existing Mock container: run the update path.
if ! command -v pct >/dev/null 2>&1; then
  if [[ -x /usr/bin/update && -d /opt/mock ]]; then exec /usr/bin/update; fi
  msg_error "Run this on a Proxmox VE host (or inside an existing ${APP} container to update)."
  exit 1
fi

header
[[ $EUID -eq 0 ]] || { msg_error "Run as root."; exit 1; }
command -v pveversion >/dev/null || { msg_error "pveversion not found; not a Proxmox VE host."; exit 1; }
[[ "$(dpkg --print-architecture)" == "amd64" ]] || { msg_error "Only amd64 is supported."; exit 1; }

pick_storage() { # $1 = content type (rootdir|vztmpl)
  local list; list=$(pvesm status -content "$1" 2>/dev/null | awk 'NR>1 && $3=="active"{print $1}')
  [[ -n "$list" ]] || { msg_error "No active storage supports '$1'."; exit 1; }
  if [[ $(wc -l <<<"$list") -eq 1 || -n "${MOCK_DEFAULTS:-}" ]]; then head -n1 <<<"$list"; return; fi
  local opts=(); while read -r s; do opts+=("$s" " "); done <<<"$list"
  whiptail --title "Storage" --menu "Storage for $1:" 16 60 6 "${opts[@]}" 3>&1 1>&2 2>&3
}

var_ctid="${var_ctid:-$(pvesh get /cluster/nextid)}"

if [[ -z "${MOCK_DEFAULTS:-}" ]] && command -v whiptail >/dev/null; then
  if ! whiptail --title "$APP LXC" --yesno "Create a new ${APP} LXC?\n\nDefaults: CT ${var_ctid}, ${var_os} ${var_version}, ${var_cpu} vCPU, ${var_ram} MiB RAM, ${var_disk} GB disk, ${var_bridge} ${var_net}." 12 64; then
    exit 0
  fi
  if whiptail --title "$APP LXC" --yes-button "Default" --no-button "Advanced" --yesno "Use default settings?" 8 50; then :; else
    ask() { whiptail --title "$APP LXC" --inputbox "$1" 8 60 "$2" 3>&1 1>&2 2>&3; }
    var_ctid=$(ask "Container ID" "$var_ctid")
    var_hostname=$(ask "Hostname" "$var_hostname")
    var_cpu=$(ask "CPU cores" "$var_cpu")
    var_ram=$(ask "RAM (MiB, the build wants ≥2048)" "$var_ram")
    var_disk=$(ask "Disk (GB)" "$var_disk")
    var_bridge=$(ask "Bridge" "$var_bridge")
    var_net=$(ask "IPv4: dhcp or CIDR (192.168.1.50/24)" "$var_net")
    [[ "$var_net" == dhcp ]] || var_gateway=$(ask "Gateway (blank for none)" "$var_gateway")
  fi
fi

pct status "$var_ctid" >/dev/null 2>&1 && { msg_error "CT $var_ctid already exists."; exit 1; }

TEMPLATE_STORAGE=$(pick_storage vztmpl)
CONTAINER_STORAGE=$(pick_storage rootdir)

msg_info "Updating LXC template list"
pveam update >/dev/null
TEMPLATE=$(pveam available -section system | awk -v p="${var_os}-${var_version}" '$2 ~ "^"p {print $2}' | sort -V | tail -n1)
[[ -n "$TEMPLATE" ]] || { msg_error "No ${var_os}-${var_version} template available."; exit 1; }
msg_ok "Template ${TEMPLATE}"

if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE"; then
  msg_info "Downloading ${TEMPLATE}"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE" >/dev/null
  msg_ok "Downloaded template"
fi

NET="name=eth0,bridge=${var_bridge},ip=${var_net}"
[[ -n "$var_gateway" ]] && NET+=",gw=${var_gateway}"

msg_info "Creating LXC ${var_ctid}"
pct create "$var_ctid" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
  --hostname "$var_hostname" --cores "$var_cpu" --memory "$var_ram" --swap 512 \
  --rootfs "${CONTAINER_STORAGE}:${var_disk}" --net0 "$NET" \
  --unprivileged "$var_unprivileged" --features nesting=1 --onboot 1 \
  --tags "mock;nodejs" --description "${APP} — https://github.com/adeelahmad/Mock" >/dev/null
msg_ok "Created LXC ${var_ctid}"

msg_info "Starting LXC"
pct start "$var_ctid"
for _ in $(seq 1 30); do
  pct exec "$var_ctid" -- getent hosts deb.debian.org >/dev/null 2>&1 && break
  sleep 2
done
pct exec "$var_ctid" -- getent hosts deb.debian.org >/dev/null 2>&1 || { msg_error "No network in the container."; exit 1; }
msg_ok "Network up"

# Prefer the install script next to this one (local checkout); otherwise fetch it.
INSTALL=$(mktemp)
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || true)
if [[ -n "$SELF_DIR" && -f "$SELF_DIR/../install/mock-install.sh" ]]; then
  cp "$SELF_DIR/../install/mock-install.sh" "$INSTALL"
else
  curl -fsSL "${RAW_BASE}/proxmox/install/mock-install.sh" -o "$INSTALL"
fi
pct push "$var_ctid" "$INSTALL" /root/mock-install.sh --perms 0755
rm -f "$INSTALL"

pct exec "$var_ctid" -- env MOCK_REPO="$REPO_URL" MOCK_BRANCH="$BRANCH" bash /root/mock-install.sh install
pct exec "$var_ctid" -- rm -f /root/mock-install.sh

IP=$(pct exec "$var_ctid" -- hostname -I | awk '{print $1}')
msg_ok "Completed successfully!"
echo -e "${BL}${APP} is running at:${CL}  http://${IP}/   https://${IP}/"
echo -e "${BL}Sign-in and sync:${CL} open the app; the setup wizard asks for the token printed above (\`pct exec ${var_ctid} mock-token\` shows it again)."
echo -e "${BL}Update later:${CL} rerun this command inside CT ${var_ctid}, or run \`update\` there."
echo -e "${YW}HTTPS uses Caddy's internal CA. Trust it (pct pull ${var_ctid} /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt root.crt) or put your own reverse proxy in front; the microphone needs a trusted HTTPS origin.${CL}"
