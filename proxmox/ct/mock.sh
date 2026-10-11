#!/usr/bin/env bash
# Mock: Proxmox VE Helper-Scripts style LXC (community-scripts engine).
#
# On the Proxmox host shell:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/adeelahmad/Mock/main/proxmox/ct/mock.sh)"
# From a checkout (also works while the repo is private):
#   bash proxmox/ct/mock.sh
# Private repo over curl: export MOCK_GITHUB_TOKEN=<read-only token> and add
#   -H "Authorization: Bearer $MOCK_GITHUB_TOKEN" to the curl above.
# Update: run `update` inside the container (or this script there).

# This repo is the "scripts root" for the community-scripts engine: it fetches
# install/mock-install.sh from here instead of community-scripts/ProxmoxVE.
MOCK_REPO="${MOCK_REPO:-adeelahmad/Mock}"
MOCK_BRANCH="${MOCK_BRANCH:-main}"
export MOCK_REPO MOCK_BRANCH MOCK_GITHUB_TOKEN
_mock_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")/.." 2>/dev/null && pwd || true)"
if [[ -n "$_mock_dir" && -f "$_mock_dir/install/mock-install.sh" ]]; then
  export COMMUNITY_SCRIPTS_ROOT="$_mock_dir"
elif [[ -n "${MOCK_GITHUB_TOKEN:-}" ]]; then
  # The engine's own fetches are unauthenticated, so stage our two files locally.
  COMMUNITY_SCRIPTS_ROOT="$(mktemp -d)" && mkdir -p "$COMMUNITY_SCRIPTS_ROOT"/{ct,install}
  for _f in ct/mock.sh install/mock-install.sh; do
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

  msg_info "Updating ${APP} to ${RELEASE:0:7}"
  $STD git reset --hard FETCH_HEAD
  $STD npm ci --include=dev --no-audit --no-fund
  $STD npm run build
  rm -rf /var/www/mock.new && cp -a dist /var/www/mock.new
  mv /var/www/mock /var/www/mock.old && mv /var/www/mock.new /var/www/mock && rm -rf /var/www/mock.old
  echo "${RELEASE}" >/opt/mock_version.txt
  $STD npm cache clean --force
  msg_ok "Updated ${APP}"

  msg_info "Reloading Caddy"
  systemctl reload caddy
  msg_ok "Reloaded Caddy"
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
