#!/usr/bin/env bash
# Mock — in-container install and update (Debian 12). Called by proxmox/ct/mock.sh.
#   mock-install.sh install   # packages, Node 22, Caddy, clone, build, serve
#   mock-install.sh update    # pull, rebuild and swap the site if the branch moved
set -Eeuo pipefail

REPO_URL="${MOCK_REPO:-https://github.com/adeelahmad/Mock.git}"
BRANCH="${MOCK_BRANCH:-main}"
SRC=/opt/mock
WWW=/var/www/mock
VERSION_FILE=/opt/mock_version.txt
export DEBIAN_FRONTEND=noninteractive PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

YW=$'\033[33m'; GN=$'\033[1;92m'; RD=$'\033[01;31m'; CL=$'\033[m'
msg_info() { printf ' %s⏳ %s...%s\n' "$YW" "$1" "$CL"; }
msg_ok()   { printf ' %s✔ %s%s\n' "$GN" "$1" "$CL"; }
msg_error(){ printf ' %s✖ %s%s\n' "$RD" "$1" "$CL" >&2; }
trap 'msg_error "Failed at line $LINENO: $BASH_COMMAND"' ERR

build_and_publish() {
  cd "$SRC"
  msg_info "Installing npm dependencies"
  npm ci --include=dev --no-audit --no-fund --loglevel=error
  msg_ok "Dependencies installed"
  msg_info "Building"
  npm run build --silent >/dev/null
  msg_ok "Built"
  # Swap the new build in whole so the server never serves a half-copied site.
  rm -rf "${WWW}.new" && cp -a dist "${WWW}.new"
  [[ -d "$WWW" ]] && mv "$WWW" "${WWW}.old"
  mv "${WWW}.new" "$WWW" && rm -rf "${WWW}.old"
  git rev-parse HEAD >"$VERSION_FILE"
}

write_caddyfile() {
  local out=${1:-/etc/caddy/Caddyfile}
  # Internal-CA certificates for the container's hostname and current IPs.
  local hosts ip
  hosts="localhost $(hostname)"
  for ip in $(hostname -I); do hosts+=" $ip"; done
  local sites; sites=$(printf 'https://%s, ' $hosts); sites=${sites%, }
  cat >"$out" <<CADDY
{
	auto_https disable_redirects
}

(mock) {
	root * ${WWW}
	encode zstd gzip
	file_server
	@nocache path /sw.js /index.html / /manifest.webmanifest /registerSW.js
	header @nocache Cache-Control "no-cache"
	header /assets/* Cache-Control "public, max-age=31536000, immutable"
}

http:// {
	import mock
}

${sites} {
	tls internal
	import mock
}
CADDY
  [[ "$out" == /etc/caddy/Caddyfile ]] || return 0
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
}

install() {
  msg_info "Installing dependencies"
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates git gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  msg_ok "Dependencies installed"

  msg_info "Installing Node.js 22"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  msg_ok "Node.js repo added"

  msg_info "Installing Caddy"
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/caddy-stable.gpg
  echo "deb [signed-by=/etc/apt/keyrings/caddy-stable.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq nodejs caddy >/dev/null
  msg_ok "Node.js $(node -v) and Caddy installed"

  msg_info "Cloning ${REPO_URL} (${BRANCH})"
  rm -rf "$SRC"
  git clone -q --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC"
  msg_ok "Cloned"

  build_and_publish
  write_caddyfile
  systemctl enable -q caddy

  cat >/usr/bin/update <<UPD
#!/usr/bin/env bash
exec env MOCK_BRANCH="${BRANCH}" bash ${SRC}/proxmox/install/mock-install.sh update
UPD
  chmod +x /usr/bin/update

  msg_info "Cleaning up"
  apt-get -y -qq autoremove >/dev/null && apt-get -y -qq autoclean >/dev/null
  npm cache clean --force >/dev/null 2>&1 || true
  msg_ok "Mock $(cut -c1-7 "$VERSION_FILE") installed"
}

update() {
  [[ -d "$SRC/.git" ]] || { msg_error "No Mock installation found in $SRC"; exit 1; }
  cd "$SRC"
  msg_info "Checking for updates"
  git fetch -q --depth 1 origin "$BRANCH"
  local remote; remote=$(git rev-parse FETCH_HEAD)
  if [[ -f "$VERSION_FILE" && "$(cat "$VERSION_FILE")" == "$remote" && -z "${MOCK_FORCE:-}" ]]; then
    msg_ok "Already up to date ($(cut -c1-7 <<<"$remote")). MOCK_FORCE=1 update to rebuild anyway."
    exit 0
  fi
  git reset -q --hard FETCH_HEAD
  msg_ok "Updated source to $(cut -c1-7 <<<"$remote")"
  # This file may just have changed under us; finish with the new version.
  exec bash "$SRC/proxmox/install/mock-install.sh" publish
}

publish() {
  build_and_publish
  write_caddyfile
  npm cache clean --force >/dev/null 2>&1 || true
  msg_ok "Mock $(cut -c1-7 "$VERSION_FILE") is live"
}

case "${1:-install}" in
  install) install ;;
  update)
    # Run update from a copy: `git reset` rewrites the checkout this file lives in.
    if [[ -z "${MOCK_COPY:-}" ]]; then
      tmp=$(mktemp); cp "${BASH_SOURCE[0]}" "$tmp"
      MOCK_COPY=1 exec bash "$tmp" update
    fi
    update ;;
  publish) publish ;;
  caddyfile) write_caddyfile "${2:-/dev/stdout}" ;;
  *) echo "usage: $0 install|update|publish|caddyfile [path]" >&2; exit 2 ;;
esac
