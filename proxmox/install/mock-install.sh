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
$STD apt install -y git caddy
msg_ok "Installed Dependencies"

NODE_VERSION="22" setup_nodejs

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
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
$STD npm ci --include=dev --no-audit --no-fund
$STD npm run build
mkdir -p /var/www
cp -a dist /var/www/mock
msg_ok "Built ${APP}"

msg_info "Configuring Caddy"
# Caddy's internal CA issues certificates for the hostname and current IPs;
# the app needs a secure origin for the microphone and service worker.
MOCK_SITES="https://localhost, https://$(hostname)"
for ip in $(hostname -I); do MOCK_SITES+=", https://${ip}"; done
cat <<CADDY >/etc/caddy/Caddyfile
{
	auto_https disable_redirects
}

(mock) {
	root * /var/www/mock
	encode zstd gzip
	file_server
	@nocache path / /index.html /sw.js /registerSW.js /manifest.webmanifest
	header @nocache Cache-Control "no-cache"
	header /assets/* Cache-Control "public, max-age=31536000, immutable"
}

http:// {
	import mock
}

${MOCK_SITES} {
	tls internal
	import mock
}
CADDY
systemctl enable -q caddy
systemctl restart caddy
if ! systemctl is-active --quiet caddy; then
  msg_error "Caddy failed to start"
  journalctl -u caddy -n 20 --no-pager
  exit 1
fi
msg_ok "Configured Caddy"

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
customize

msg_info "Cleaning up"
$STD npm cache clean --force
msg_ok "Cleaned up"
cleanup_lxc
