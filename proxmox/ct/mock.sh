#!/usr/bin/env bash
# Mock: Proxmox VE LXC. On the Proxmox host shell:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/adeelahmad/Mock/main/proxmox/ct/mock.sh)"
#
# It offers two ways in:
#   Prebuilt template (fast)  downloads the release's Debian 13 template with Mock, Caddy and the
#                             services inside, and runs `pct create`. Ready in under a minute.
#   Build from source         the community-scripts helper wizard; builds Mock in the container.
# Skip the question with MOCK_MODE=template or MOCK_MODE=source. Template options (env):
#   CTID (next free)  MOCK_HOSTNAME (mock)  MOCK_STORAGE (local-lvm)  MOCK_TEMPLATE_STORAGE (local)
#   MOCK_DISK (8)  MOCK_CORES (2)  MOCK_RAM (2048)  MOCK_BRIDGE (vmbr0)  MOCK_TAG (latest)
#   MOCK_SSH_KEYS (a public key file for root)
# Update: run `update` inside the container (or this script there).

MOCK_REPO="${MOCK_REPO:-adeelahmad/Mock}"
MOCK_BRANCH="${MOCK_BRANCH:-main}"

# Prebuilt template: download it into the template storage, then pct create and start.
mock_from_template() {
  set -euo pipefail
  local arch tag base file tstore path ctid store
  arch="$(dpkg --print-architecture)"
  case "$arch" in amd64 | arm64) ;; *) echo "No prebuilt template for $arch; use MOCK_MODE=source" >&2; return 1 ;; esac
  tag="${MOCK_TAG:-latest}"
  if [[ "$tag" == latest ]]; then
    tag="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${MOCK_REPO}/releases/latest")"
    tag="${tag##*/}"
  fi
  base="https://github.com/${MOCK_REPO}/releases/download/${tag}"
  tstore="${MOCK_TEMPLATE_STORAGE:-local}"
  file="mock-lxc-debian13-${tag}-${arch}.tar.zst"
  path="$(pvesm path "${tstore}:vztmpl/${file}")"
  if [[ ! -s "$path" ]]; then
    echo "Downloading the Mock ${tag} template (${arch})"
    mkdir -p "$(dirname "$path")"
    curl -fL --progress-bar "${base}/mock-lxc-debian13-${arch}.tar.zst" -o "${path}.part"
    curl -fsSL "${base}/checksums.txt" | grep " mock-lxc-debian13-${arch}.tar.zst\$" | sed "s#  .*#  ${path}.part#" | sha256sum -c --quiet
    mv "${path}.part" "$path"
  fi

  ctid="${CTID:-$(pvesh get /cluster/nextid)}"
  store="${MOCK_STORAGE:-local-lvm}"
  local extra=()
  [[ -n "${MOCK_SSH_KEYS:-}" ]] && extra+=(--ssh-public-keys "$MOCK_SSH_KEYS")
  echo "Creating container ${ctid}"
  pct create "$ctid" "${tstore}:vztmpl/${file}" \
    --hostname "${MOCK_HOSTNAME:-mock}" --ostype debian --unprivileged 1 --features nesting=1 \
    --cores "${MOCK_CORES:-2}" --memory "${MOCK_RAM:-2048}" --swap 512 \
    --rootfs "${store}:${MOCK_DISK:-8}" --net0 "name=eth0,bridge=${MOCK_BRIDGE:-vmbr0},ip=dhcp,ip6=auto" \
    --tags "interview;pwa" --onboot 1 --start 1 "${extra[@]}"

  local ip=""
  for _ in $(seq 60); do
    [[ "$(pct exec "$ctid" -- systemctl is-active mock-firstboot 2>/dev/null)" == active ]] &&
      ip="$(pct exec "$ctid" -- hostname -I 2>/dev/null | awk '{print $1}')" && [[ -n "$ip" ]] && break
    sleep 2
  done
  echo
  echo "Mock ${tag} is running in container ${ctid}. Open (HTTPS is needed for the microphone):"
  echo "  https://${ip:-<container ip>}"
  echo "Trust Caddy's internal CA on your devices:"
  echo "  pct pull ${ctid} /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt mock-root.crt"
  echo "Setup token for the sign-in wizard:"
  echo "  pct exec ${ctid} -- mock-token"
  echo "Root has no password; set one with: pct exec ${ctid} -- passwd"
}

if [[ -z "${MOCK_MODE:-}" && ! -d /opt/mock ]] && command -v pct >/dev/null; then
  if command -v whiptail >/dev/null && [[ -t 0 ]]; then
    if whiptail --title "Mock" --yes-button "Prebuilt" --no-button "From source" --yesno \
      "Use the prebuilt template (fast: download and pct create), or build Mock from source with the helper-script wizard?" 10 70; then
      MOCK_MODE=template
    else
      MOCK_MODE=source
    fi
  else
    MOCK_MODE=template
  fi
fi
if [[ "${MOCK_MODE:-}" == template ]]; then
  (mock_from_template)
  exit $?
fi

# Build from source: the community-scripts engine and install/mock-install.sh.
export MOCK_REPO MOCK_BRANCH MOCK_GITHUB_TOKEN
# This repo is the "scripts root" for the community-scripts engine: it fetches
# install/mock-install.sh from here instead of community-scripts/ProxmoxVE.
_mock_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")/.." 2>/dev/null && pwd || true)"
if [[ -n "$_mock_dir" && -f "$_mock_dir/install/mock-install.sh" ]]; then
  export COMMUNITY_SCRIPTS_ROOT="$_mock_dir"
elif [[ -n "${MOCK_GITHUB_TOKEN:-}" ]]; then
  # The engine's own fetches are unauthenticated, so stage our two files locally.
  COMMUNITY_SCRIPTS_ROOT="$(mktemp -d)" && mkdir -p "$COMMUNITY_SCRIPTS_ROOT"/{ct,install}
  for _f in ct/mock.sh install/mock-install.sh banner.sh; do
    curl -fsSL -H "Authorization: Bearer ${MOCK_GITHUB_TOKEN}" \
      "https://raw.githubusercontent.com/${MOCK_REPO}/${MOCK_BRANCH}/proxmox/${_f}" -o "$COMMUNITY_SCRIPTS_ROOT/$_f" || exit 1
  done
  export COMMUNITY_SCRIPTS_ROOT
else
  export COMMUNITY_SCRIPTS_URL="https://raw.githubusercontent.com/${MOCK_REPO}/${MOCK_BRANCH}/proxmox"
fi
unset _mock_dir _f

source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Author: Adeel Ahmad (adeelahmad)
# License: MIT
# Source: https://github.com/adeelahmad/Mock

APP="Mock"
var_tags="${var_tags:-interview;pwa}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-2048}"
var_disk="${var_disk:-8}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_unprivileged="${var_unprivileged:-1}"

# Mock's own banner: the engine looks headers up in its own repo, which has none for Mock.
if [[ -n "${COMMUNITY_SCRIPTS_ROOT:-}" && -f "$COMMUNITY_SCRIPTS_ROOT/banner.sh" ]]; then
  source "$COMMUNITY_SCRIPTS_ROOT/banner.sh"
else
  source <(curl -fsSL "https://raw.githubusercontent.com/${MOCK_REPO}/${MOCK_BRANCH}/proxmox/banner.sh") 2>/dev/null || true
fi
if declare -f mock_banner >/dev/null; then
  header_info() {
    [[ "${_MOCK_HEADER_SHOWN:-0}" == "1" ]] && return 0
    _MOCK_HEADER_SHOWN=1
    clear 2>/dev/null || true
    mock_banner
  }
fi

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources

  if [[ ! -d /opt/mock/.git ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  cd /opt/mock || exit
  $STD git fetch --depth 1 origin "${MOCK_BRANCH}"
  RELEASE=$(git rev-parse FETCH_HEAD)
  if [[ "${RELEASE}" == "$(cat /opt/mock_version.txt 2>/dev/null)" ]]; then
    msg_ok "No update required. ${APP} is already at ${RELEASE:0:7}"
    exit
  fi

  NODE_VERSION="22" setup_nodejs
  setup_go

  msg_info "Updating ${APP} to ${RELEASE:0:7}"
  $STD git reset --hard FETCH_HEAD
  export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 GOTOOLCHAIN=auto
  $STD npm ci --include=dev --no-audit --no-fund
  $STD make binary
  install -m 0755 bin/mock /usr/local/bin/mock.new && mv /usr/local/bin/mock.new /usr/local/bin/mock
  echo "${RELEASE}" >/opt/mock_version.txt
  $STD npm cache clean --force
  $STD go clean -cache -modcache
  $STD make clean && rm -rf node_modules
  msg_ok "Updated ${APP}"

  msg_info "Restarting Mock and Caddy"
  $STD bash /opt/mock/proxmox/install/mock-server.sh
  msg_ok "Restarted Mock and Caddy"
  msg_ok "Updated successfully!"
  exit
}

start
build_container
description

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW}Access it using the following URL (HTTPS is needed for the microphone):${CL}"
echo -e "${GATEWAY}${BGN}https://${IP}${CL}"
echo -e "${INFO}${YW}The certificate comes from Caddy's internal CA; trust it on your devices:${CL}"
echo -e "${TAB}pct pull ${CTID} /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt mock-root.crt"
echo -e "${INFO}${YW}Sign-in and library sync: the app opens a setup wizard that asks for this token:${CL}"
echo -e "${TAB}pct exec ${CTID} -- mock-token"
