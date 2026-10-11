#!/usr/bin/env bash
# Mock: sets up (or refreshes) the Mock server inside the container. Idempotent; run by the
# install script and by every update, from the checkout in /opt/mock.
#
#   Caddy      serves the built app from /var/www/mock and proxies /api and /auth
#   mock-server.service   the Mock server (sign-in + library sync) on 127.0.0.1:8787,
#              SQLite in /var/lib/mock; extra settings (DATABASE_URL, AUTH_URL) in /etc/mock/server.env
#   mock-token prints the setup token the first-run sign-in wizard asks for
set -euo pipefail

SRC=/opt/mock
DATA=/var/lib/mock
ENV_FILE=/etc/mock/server.env
NODE_FLAGS="--experimental-strip-types --disable-warning=ExperimentalWarning"

id -u mock >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin mock
install -d -o mock -g mock -m 0750 "$DATA"
install -d -m 0755 /etc/mock
[[ -f "$ENV_FILE" ]] || cat >"$ENV_FILE" <<'ENV'
# Mock server settings (see server/main.ts). Restart after changes: systemctl restart mock-server
# DATABASE_URL=postgres://user:pass@host/mock
# AUTH_URL=https://mock.example.com
ENV

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
ExecStart=/usr/bin/node ${NODE_FLAGS} server/main.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

cat >/usr/bin/mock-token <<TOK
#!/usr/bin/env bash
# Prints the setup token the first-run sign-in wizard asks for.
set -a; [[ -f ${ENV_FILE} ]] && source ${ENV_FILE}; set +a
cd ${SRC} && exec runuser -u mock -- env MOCK_DB=${DATA}/mock.db DATABASE_URL="\${DATABASE_URL:-}" /usr/bin/node ${NODE_FLAGS} server/main.ts token
TOK
chmod +x /usr/bin/mock-token

# Caddy's internal CA issues certificates for the hostname and current IPs;
# the app needs a secure origin for the microphone and service worker.
MOCK_SITES="https://localhost, https://$(hostname)"
for ip in $(hostname -I); do MOCK_SITES+=", https://${ip}"; done
cat <<CADDY >/etc/caddy/Caddyfile
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
		root * /var/www/mock
		file_server
	}
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

systemctl daemon-reload
systemctl enable -q mock-server caddy
systemctl restart mock-server
systemctl reload caddy 2>/dev/null || systemctl restart caddy
