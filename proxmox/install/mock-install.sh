#!/usr/bin/env bash
# Mock — in-container install and update (Debian 12). Called by proxmox/ct/mock.sh.
#   mock-install.sh install   # packages, Node 22, Caddy, clone, build, serve
#   mock-install.sh update    # pull, rebuild and swap the site if the branch moved
# Caddy serves the built app; the Mock server (sign-in + library sync, systemd `mock-server`)
# answers /api and /auth on 127.0.0.1:8787 with its SQLite database in /var/lib/mock.
set -Eeuo pipefail

REPO_URL="${MOCK_REPO:-https://github.com/adeelahmad/Mock.git}"
BRANCH="${MOCK_BRANCH:-main}"
SRC=/opt/mock
WWW=/var/www/mock
VERSION_FILE=/opt/mock_version.txt
DATA=/var/lib/mock
ENV_FILE=/etc/mock/server.env
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
	encode zstd gzip
	@server path /api/* /auth/*
	handle @server {
		reverse_proxy 127.0.0.1:8787
	}
	handle {
		root * ${WWW}
		file_server
	}
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

write_server_service() {
  id -u mock >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin mock
  install -d -o mock -g mock -m 0750 "$DATA"
  install -d -m 0755 /etc/mock
  # Extra settings (DATABASE_URL for Postgres, AUTH_URL behind your own proxy…) go here.
  [[ -f "$ENV_FILE" ]] || printf '# Mock server settings (see server/main.ts)\n# DATABASE_URL=postgres://user:pass@host/mock\n# AUTH_URL=https://mock.example.com\n' >"$ENV_FILE"
  cat >/etc/systemd/system/mock-server.service <<UNIT
[Unit]
Description=Mock server (sign-in and library sync)
After=network-online.target
Wants=network-online.target

[Service]
User=mock
WorkingDirectory=${SRC}
Environment=NODE_ENV=production PORT=8787 HOST=127.0.0.1 MOCK_DB=${DATA}/mock.db MOCK_STATIC=
EnvironmentFile=-${ENV_FILE}
ExecStart=/usr/bin/node --experimental-strip-types --disable-warning=ExperimentalWarning server/main.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT
  cat >/usr/bin/mock-token <<TOK
#!/usr/bin/env bash
# Prints the setup token the first-run sign-in wizard asks for.
cd ${SRC} && exec runuser -u mock -- env MOCK_DB=${DATA}/mock.db /usr/bin/node --experimental-strip-types --disable-warning=ExperimentalWarning server/main.ts token
TOK
  chmod +x /usr/bin/mock-token
  systemctl daemon-reload
  systemctl enable -q mock-server
  systemctl restart mock-server
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
  write_server_service
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
  sleep 2
  msg_ok "Sign-in setup token: $(/usr/bin/mock-token 2>/dev/null || echo 'run mock-token')"
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
  write_server_service
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
  token) exec /usr/bin/mock-token ;;
  *) echo "usage: $0 install|update|publish|caddyfile [path]|token" >&2; exit 2 ;;
esac
