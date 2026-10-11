package server

// Signaling for passphrase sync (internal/signal). Behind the server's own sign-in by default,
// so a self-hosted Mock (for example behind a Cloudflare Tunnel) relays only for its own users:
//
//	GET /signal               WebSocket; the session cookie (same origin) or ?token=
//	GET /api/signal/token     a signaling token for the signed-in user { token, url, expiresIn }
//	GET /signal/connect       a small page for an app served elsewhere (GitHub Pages): it signs
//	                          you in here, then hands the token back to the app that opened it
//	                          (window.opener, only for origins in MOCK_SIGNAL_ORIGINS)

import (
	"encoding/json"
	"html/template"
	"net/http"
	"net/url"
	"strings"

	"github.com/adeelahmad/mock/internal/auth"
	"github.com/adeelahmad/mock/internal/signal"
	"github.com/coder/websocket"
)

// Signal modes: "auth" (default: signed-in users only), "open" (anyone), "off".
const (
	SignalAuth = "auth"
	SignalOpen = "open"
	SignalOff  = "off"
)

// DefaultSignalOrigins are the app origins /signal/connect hands tokens to out of the box.
var DefaultSignalOrigins = []string{"https://adeelahmad.github.io"}

func signalMode(m string) string {
	switch strings.ToLower(strings.TrimSpace(m)) {
	case SignalOpen:
		return SignalOpen
	case SignalOff:
		return SignalOff
	default:
		return SignalAuth
	}
}

func originAllowed(origin string, allowed []string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || u.Path != "" {
		return false
	}
	if u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1") {
		return true
	}
	for _, a := range allowed {
		if strings.EqualFold(strings.TrimRight(strings.TrimSpace(a), "/"), origin) {
			return true
		}
	}
	return false
}

func signalRoutes(mux *http.ServeMux, o Options, a *auth.Auth, hub *signal.Hub) http.Handler {
	mode := signalMode(o.Signal)
	origins := o.SignalOrigins
	if origins == nil {
		origins = DefaultSignalOrigins
	}

	mux.HandleFunc("GET /api/signal/token", func(w http.ResponseWriter, r *http.Request) {
		u := a.User(r)
		if u == nil {
			errJSON(w, 401, "signed_out", "")
			return
		}
		writeJSON(w, 200, map[string]any{"token": a.SignalToken(u.ID), "url": publicBase(a, r), "expiresIn": int(auth.SignalTokenTTL.Seconds())})
	})

	mux.HandleFunc("GET /signal/connect", func(w http.ResponseWriter, r *http.Request) {
		origin := r.URL.Query().Get("origin")
		if !originAllowed(origin, origins) {
			http.Error(w, "This app's address is not allowed to use this server (MOCK_SIGNAL_ORIGINS).", http.StatusForbidden)
			return
		}
		data := map[string]any{"Origin": origin, "Base": publicBase(a, r), "Self": r.URL.RequestURI(), "Mode": mode}
		if u := a.User(r); u != nil {
			b, _ := json.Marshal(map[string]any{"type": "mock-signal", "url": publicBase(a, r), "token": a.SignalToken(u.ID), "user": u.Name})
			data["Payload"] = template.JS(b)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_ = connectPage.Execute(w, data)
	})

	// The WebSocket itself: checked before anything else takes the upgrade (the Meet bridge).
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if mode == SignalOff {
			errJSON(w, 404, "not_found", "")
			return
		}
		scope, viaCookie := "", false
		if u := a.User(r); u != nil {
			scope, viaCookie = u.ID, true
		} else if uid := a.SignalUser(r.URL.Query().Get("token")); uid != "" {
			scope = uid
		} else if mode != SignalOpen {
			errJSON(w, 401, "signed_out", "Sign in to use this server's relay")
			return
		}
		// A cookie is ambient: only this site's own pages may use it. A token is a bearer
		// credential the app was handed on purpose, from whatever origin it runs on.
		opts := &websocket.AcceptOptions{InsecureSkipVerify: !viaCookie}
		ws, err := websocket.Accept(w, r, opts)
		if err != nil {
			return
		}
		hub.Serve(r.Context(), ws, scope)
	})
}

func publicBase(a *auth.Auth, r *http.Request) string {
	if a.PublicURL != "" {
		return strings.TrimRight(a.PublicURL, "/") + "/"
	}
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]), "https") {
		scheme = "https"
	}
	host := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0])
	if host == "" {
		host = r.Host
	}
	return scheme + "://" + host + "/"
}

var connectPage = template.Must(template.New("connect").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Mock</title>
<style>
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1d1b17;--mut:#6b675e;--line:#e4e0d6;--acc:#d9531e}
@media (prefers-color-scheme:dark){:root{--bg:#141310;--fg:#f1eee6;--mut:#a29d92;--line:#2c2a25}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{max-width:420px;width:100%}h1{font-size:22px;margin:0 0 8px}p{color:var(--mut);margin:0 0 20px}
button{display:block;width:100%;margin:8px 0;padding:12px 16px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--fg);font:inherit;cursor:pointer}
button:hover{border-color:var(--acc)}
</style></head><body><main>
{{if .Payload}}
<h1>Connected.</h1><p id="msg">Handing this device's sync relay to the Mock app. This window closes by itself.</p>
<script>
(function(){var p={{.Payload}};
if(window.opener){window.opener.postMessage(p,{{.Origin}});setTimeout(function(){window.close()},400)}
else{document.getElementById('msg').textContent='Open this page from Mock: Settings, Sync, Use my Mock server.'}})();
</script>
{{else}}
<h1>Sign in to your Mock server.</h1><p>Your devices will use this server to find each other. Your library never passes through it.</p>
<div id="providers"></div>
<script>
(async function(){
var s=await (await fetch({{.Base}}+'api/status',{credentials:'same-origin'})).json();
var box=document.getElementById('providers');
if(!s.configured){box.textContent='Sign-in is not set up on this server yet. Open it and finish the setup first.';return}
s.providers.forEach(function(p){var b=document.createElement('button');b.textContent='Sign in with '+p.name;b.onclick=async function(){
var c=await (await fetch({{.Base}}+'auth/csrf',{credentials:'same-origin'})).json();
var f=document.createElement('form');f.method='POST';f.action={{.Base}}+'auth/signin/'+p.id;
[['csrfToken',c.csrfToken],['callbackUrl',{{.Self}}]].forEach(function(kv){var i=document.createElement('input');i.type='hidden';i.name=kv[0];i.value=kv[1];f.appendChild(i)});
document.body.appendChild(f);f.submit()};box.appendChild(b)});
})();
</script>
{{end}}
</main></body></html>`))
