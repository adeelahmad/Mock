#!/usr/bin/env bash

# Author: Adeel Ahmad (adeelahmad)
# License: MIT
# Source: https://github.com/adeelahmad/Mock

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt install -y git caddy make
msg_ok "Installed Dependencies"

# Node builds the web app and Go builds the binary that embeds it; only the binary runs.
NODE_VERSION="22" setup_nodejs
setup_go

msg_info "Cloning ${APP}"
MOCK_REPO="${MOCK_REPO:-adeelahmad/Mock}"
MOCK_BRANCH="${MOCK_BRANCH:-main}"
if [[ -n "${MOCK_GITHUB_TOKEN:-}" ]]; then
  MOCK_URL="https://x-access-token:${MOCK_GITHUB_TOKEN}@github.com/${MOCK_REPO}.git"
else
  MOCK_URL="https://github.com/${MOCK_REPO}.git"
fi
$STD git clone --depth 1 --branch "${MOCK_BRANCH}" "${MOCK_URL}" /opt/mock
RELEASE=$(git -C /opt/mock rev-parse HEAD)
msg_ok "Cloned ${APP} ${RELEASE:0:7}"

msg_info "Building ${APP}"
cd /opt/mock || exit
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 GOTOOLCHAIN=auto
$STD npm ci --include=dev --no-audit --no-fund
$STD make binary
install -m 0755 bin/mock /usr/local/bin/mock
msg_ok "Built ${APP} (/usr/local/bin/mock)"

msg_info "Configuring Caddy and the Mock server"
bash /opt/mock/proxmox/install/mock-server.sh
for svc in caddy mock; do
  if ! systemctl is-active --quiet "$svc"; then
    msg_error "$svc failed to start"
    journalctl -u "$svc" -n 20 --no-pager
    exit 1
  fi
done
msg_ok "Configured Caddy and the Mock server"

echo "${RELEASE}" >/opt/mock_version.txt

# The engine's /usr/bin/update fetches ct/mock.sh over plain curl, which fails
# while the repo is private; run the checkout's copy instead (git pull first).
cat <<UPD >/usr/bin/update
#!/usr/bin/env bash
git -C /opt/mock pull -q --ff-only origin "${MOCK_BRANCH}" 2>/dev/null || true
MOCK_BRANCH="${MOCK_BRANCH}" exec bash /opt/mock/proxmox/ct/mock.sh
UPD
chmod +x /usr/bin/update

motd_ssh
# Mock's banner at the top of the login details, and where to open the app at the bottom.
sed -i '1a [ -n "$BASH_VERSION" ] \&\& [ -r /opt/mock/proxmox/banner.sh ] \&\& . /opt/mock/proxmox/banner.sh \&\& mock_banner' /etc/profile.d/00_lxc-details.sh
cat <<'MOTD' >>/etc/profile.d/00_lxc-details.sh
echo -e "    \e[1;38;2;249;171;0m●\e[0m Mock: \e[1mhttps://$(hostname -I | awk '{print $1}')\e[0m   setup token: \e[1mmock-token\e[0m"
echo ""
MOTD
customize

msg_info "Cleaning up"
$STD npm cache clean --force
$STD go clean -cache -modcache
$STD make -C /opt/mock clean && rm -rf /opt/mock/node_modules
msg_ok "Cleaned up"
cleanup_lxc
