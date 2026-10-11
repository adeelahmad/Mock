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

MOCK_REPO="${MOCK_REPO:-adeelahmad/Mock}"
MOCK_BRANCH="${MOCK_BRANCH:-main}"
if [[ -n "${MOCK_GITHUB_TOKEN:-}" ]]; then
  MOCK_URL="https://x-access-token:${MOCK_GITHUB_TOKEN}@github.com/${MOCK_REPO}.git"
else
  MOCK_URL="https://github.com/${MOCK_REPO}.git"
fi

# The release tag to install: MOCK_TAG, else the latest release. Empty when there is none.
mock_release_tag() {
  local tag="${MOCK_TAG:-}"
  [[ -z "$tag" ]] && tag="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${MOCK_REPO}/releases/latest" 2>/dev/null)" && tag="${tag##*/}"
  [[ "$tag" == v* ]] && echo "$tag"
  return 0
}

# Downloads the release's prebuilt binary, checks it against checksums.txt, installs it.
mock_install_release_binary() {
  local tag="$1" arch tmp base
  arch="$(dpkg --print-architecture)"
  tmp="$(mktemp -d)"
  base="https://github.com/${MOCK_REPO}/releases/download/${tag}"
  curl -fsSL "${base}/mock-linux-${arch}" -o "${tmp}/mock-linux-${arch}" &&
    curl -fsSL "${base}/checksums.txt" -o "${tmp}/checksums.txt" &&
    (cd "$tmp" && grep " mock-linux-${arch}\$" checksums.txt | sha256sum -c --quiet) &&
    install -m 0755 "${tmp}/mock-linux-${arch}" /usr/local/bin/mock.new &&
    mv /usr/local/bin/mock.new /usr/local/bin/mock
  local rc=$?
  rm -rf "$tmp"
  return $rc
}

MOCK_RELEASE_TAG="$(mock_release_tag)"
if [[ -n "$MOCK_RELEASE_TAG" ]]; then
  # The normal path: the prebuilt binary. The checkout only carries the service scripts.
  msg_info "Installing ${APP} ${MOCK_RELEASE_TAG}"
  $STD git clone --depth 1 --branch "${MOCK_RELEASE_TAG}" "${MOCK_URL}" /opt/mock
  mock_install_release_binary "${MOCK_RELEASE_TAG}" || { msg_error "Could not download the ${MOCK_RELEASE_TAG} binary"; exit 1; }
  RELEASE="${MOCK_RELEASE_TAG}"
  msg_ok "Installed ${APP} ${RELEASE} (/usr/local/bin/mock)"
else
  # No release published yet: build from source. Node builds the web app and Go builds the
  # binary that embeds it; both are removed again, only the binary runs.
  msg_info "No ${APP} release yet; building from source"
  $STD apt install -y make
  NODE_VERSION="22" setup_nodejs
  setup_go
  $STD git clone --depth 1 --branch "${MOCK_BRANCH}" "${MOCK_URL}" /opt/mock
  RELEASE=$(git -C /opt/mock rev-parse HEAD)
  cd /opt/mock || exit
  export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 GOTOOLCHAIN=auto
  $STD npm ci --include=dev --no-audit --no-fund
  $STD make binary
  install -m 0755 bin/mock /usr/local/bin/mock
  $STD npm cache clean --force
  $STD go clean -cache -modcache
  $STD make -C /opt/mock clean && rm -rf /opt/mock/node_modules
  msg_ok "Built ${APP} ${RELEASE:0:7} (/usr/local/bin/mock)"
fi

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

# The engine's /usr/bin/update fetches ct/mock.sh over plain curl, which fails for a private
# fork; run the checkout's copy instead (it fetches the latest release, or main, first).
cat <<UPD >/usr/bin/update
#!/usr/bin/env bash
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

cleanup_lxc
