#!/usr/bin/env bash
# Mock: sets up (or refreshes) the Mock service inside the container. Idempotent; run by the
# install script and by every update, after /usr/local/bin/mock is in place.
#
#   mock.service  the Mock binary: the app (embedded), sign-in and library sync, on 127.0.0.1:8787,
#                 SQLite in /var/lib/mock; extra settings (DATABASE_URL, AUTH_URL) in /etc/mock/server.env
#   Caddy         HTTPS in front of it (the microphone and service worker need a secure origin)
#   mock-token    prints the setup token the first-run sign-in wizard asks for
set -euo pipefail

BIN=/usr/local/bin/mock
DATA=/var/lib/mock
ENV_FILE=/etc/mock/server.env

id -u mock >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin mock
install -d -o mock -g mock -m 0750 "$DATA"
install -d -m 0755 /etc/mock
[[ -f "$ENV_FILE" ]] || cat >"$ENV_FILE" <<'ENV'
# Mock settings (`mock help` lists them). Restart after changes: systemctl restart mock
# DATABASE_URL=postgres://user:pass@host/mock
# AUTH_URL=https://mock.example.com
ENV

# The Node server this replaces.
if systemctl list-unit-files mock-server.service >/dev/null 2>&1; then
  systemctl disable --now mock-server >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/mock-server.service
fi

cat >/etc/systemd/system/mock.service <<UNIT
[Unit]
Description=Mock (app, sign-in and library sync)
After=network-online.target
Wants=network-online.target

[Service]
User=mock
WorkingDirectory=${DATA}
Environment=PORT=8787 HOST=127.0.0.1 MOCK_DB=${DATA}/mock.db
EnvironmentFile=-${ENV_FILE}
ExecStart=${BIN}
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

cat >/usr/bin/mock-token <<TOK
#!/usr/bin/env bash
# Prints the setup token the first-run sign-in wizard asks for.
set -a; [[ -f ${ENV_FILE} ]] && source ${ENV_FILE}; set +a
cd ${DATA} && exec runuser -u mock -- env MOCK_DB=${DATA}/mock.db DATABASE_URL="\${DATABASE_URL:-}" ${BIN} token
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
	reverse_proxy 127.0.0.1:8787
}

http:// {
	import mock
}

${MOCK_SITES} {
	tls internal
	import mock
}
CADDY
rm -rf /var/www/mock

systemctl daemon-reload
systemctl enable -q mock caddy
systemctl restart mock
systemctl reload caddy 2>/dev/null || systemctl restart caddy
