// Package server is the Mock server's HTTP surface. Small on purpose: the app stays local-first
// and works without it; with it, a signed-in user's library follows them to every browser.
//
//	GET  /api/status          server present? set up? which sign-in buttons? who is signed in?
//	POST /api/setup/verify    the first-run wizard checks the setup token
//	GET  /api/setup           the setup with secrets redacted (setup token or admin)
//	PUT  /api/setup           saves OAuth clients and the email allowlist (setup token or admin)
//	GET  /api/library         this user's synced library { rev, doc, updatedAt } (204 if none)
//	PUT  /api/library         { baseRev, doc } → { rev } or 409 { current } when another browser won
//	DELETE /api/library       forget the synced copy (the browsers keep theirs)
//	/auth/*                   sign-in, OAuth callbacks, sign-out, csrf, session
//	WebSocket upgrades        the Meet bridge, when enabled
//	everything else           the app (embedded in the binary, or a directory)
package server

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/adeelahmad/mock/internal/auth"
	"github.com/adeelahmad/mock/internal/store"
	"github.com/klauspost/compress/gzhttp"
)

const libraryLimit = 50 << 20

type Options struct {
	Store      *store.Store
	Auth       *auth.Auth
	SetupToken string
	// Static is the built app; nil serves the API only.
	Static  fs.FS
	Version string
	// Bridge, when set, takes WebSocket upgrades (the Meet bridge).
	Bridge http.Handler
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func errJSON(w http.ResponseWriter, status int, code, message string) {
	body := map[string]string{"error": code}
	if message != "" {
		body["message"] = message
	}
	writeJSON(w, status, body)
}

func sameToken(a, b string) bool {
	a = strings.TrimSpace(a)
	return a != "" && b != "" && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func str(v any, max int) string {
	s, _ := v.(string)
	s = strings.TrimSpace(s)
	if len(s) > max {
		s = s[:max]
	}
	return s
}

type clientView struct {
	ClientID  string `json:"clientId"`
	HasSecret bool   `json:"hasSecret"`
	Issuer    string `json:"issuer,omitempty"`
	Name      string `json:"name,omitempty"`
}

// Redact is the setup as the wizard sees it: no secrets.
func Redact(s *auth.Setup) map[string]any {
	view := func(c *auth.OAuthClient) any {
		if c == nil {
			return nil
		}
		return clientView{ClientID: c.ClientID, HasSecret: c.ClientSecret != ""}
	}
	var gh, gg, oi any
	emails := []string{}
	hasAdmin := false
	if s != nil {
		gh, gg = view(s.Providers.GitHub), view(s.Providers.Google)
		if o := s.Providers.OIDC; o != nil {
			// The wizard expects issuer and name keys even when empty.
			oi = map[string]any{"clientId": o.ClientID, "hasSecret": o.ClientSecret != "", "issuer": o.Issuer, "name": o.Name}
		}
		if s.AllowedEmails != nil {
			emails = s.AllowedEmails
		}
		hasAdmin = s.AdminUserID != nil
	}
	return map[string]any{
		"configured":    len(auth.ProviderList(s)) > 0,
		"providers":     map[string]any{"github": gh, "google": gg, "oidc": oi},
		"allowedEmails": emails,
		"hasAdmin":      hasAdmin,
	}
}

// merge is a submitted client over the stored one: an empty secret keeps the stored secret.
func merge(next any, prev *auth.OAuthClient) *auth.OAuthClient {
	n, _ := next.(map[string]any)
	id := str(n["clientId"], 500)
	if id == "" {
		return nil
	}
	secret := str(n["clientSecret"], 2000)
	if secret == "" && prev != nil && prev.ClientID == id {
		secret = prev.ClientSecret
	}
	return &auth.OAuthClient{ClientID: id, ClientSecret: secret}
}

var (
	emailRe   = regexp.MustCompile(`^[^@\s]+@[^@\s]+$`)
	splitRe   = regexp.MustCompile(`[\s,;]+`)
	issuerOK  = regexp.MustCompile(`(?i)^https://`)
	localhost = regexp.MustCompile(`(?i)^http://(localhost|127\.0\.0\.1)`)
	noCache   = regexp.MustCompile(`(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$`)
)

func isDoc(raw json.RawMessage) bool {
	var d struct {
		App    any `json:"app"`
		Tables any `json:"tables"`
	}
	if json.Unmarshal(raw, &d) != nil {
		return false
	}
	_, tablesObj := d.Tables.(map[string]any)
	return d.App == "mock" && tablesObj
}

// New is the whole site.
func New(o Options) http.Handler {
	mux := http.NewServeMux()
	a := o.Auth

	user := func(r *http.Request) *auth.SessionUser { return a.User(r) }
	canSetup := func(r *http.Request) bool {
		if sameToken(r.Header.Get("X-Setup-Token"), o.SetupToken) {
			return true
		}
		u := user(r)
		return u != nil && u.Admin
	}
	readJSON := func(w http.ResponseWriter, r *http.Request, v any) bool {
		r.Body = http.MaxBytesReader(w, r.Body, libraryLimit)
		if err := json.NewDecoder(r.Body).Decode(v); err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				errJSON(w, http.StatusRequestEntityTooLarge, "entity.too.large", "request entity too large")
			} else {
				errJSON(w, http.StatusBadRequest, "entity.parse.failed", "Expected JSON")
			}
			return false
		}
		return true
	}

	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"server": true, "version": o.Version, "db": o.Store.Kind, "configured": len(auth.ProviderList(a.Setup())) > 0, "providers": auth.ProviderList(a.Setup()), "user": user(r)})
	})

	mux.HandleFunc("POST /api/setup/verify", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Token string `json:"token"`
		}
		if !readJSON(w, r, &b) {
			return
		}
		if sameToken(b.Token, o.SetupToken) {
			writeJSON(w, 200, map[string]bool{"ok": true})
		} else {
			errJSON(w, 403, "bad_token", "That is not the setup token. It is printed in the server log when the server starts.")
		}
	})

	mux.HandleFunc("GET /api/setup", func(w http.ResponseWriter, r *http.Request) {
		if !canSetup(r) {
			errJSON(w, 403, "forbidden", "")
			return
		}
		writeJSON(w, 200, Redact(a.Setup()))
	})

	mux.HandleFunc("PUT /api/setup", func(w http.ResponseWriter, r *http.Request) {
		if !canSetup(r) {
			errJSON(w, 403, "forbidden", "")
			return
		}
		var b map[string]any
		if !readJSON(w, r, &b) {
			return
		}
		p, _ := b["providers"].(map[string]any)
		var prevGH, prevGG, prevOI *auth.OAuthClient
		var admin *string
		if prev := a.Setup(); prev != nil {
			prevGH, prevGG, admin = prev.Providers.GitHub, prev.Providers.Google, prev.AdminUserID
			if prev.Providers.OIDC != nil {
				prevOI = &prev.Providers.OIDC.OAuthClient
			}
		}
		gh, gg, oc := merge(p["github"], prevGH), merge(p["google"], prevGG), merge(p["oidc"], prevOI)
		var oidc *auth.OIDCClient
		oRaw, _ := p["oidc"].(map[string]any)
		if oc != nil && str(oRaw["issuer"], 500) != "" {
			oidc = &auth.OIDCClient{OAuthClient: *oc, Issuer: str(oRaw["issuer"], 500), Name: str(oRaw["name"], 60)}
		}
		for _, c := range []*auth.OAuthClient{gh, gg, func() *auth.OAuthClient {
			if oidc == nil {
				return nil
			}
			return &oidc.OAuthClient
		}()} {
			if c != nil && c.ClientSecret == "" {
				errJSON(w, 400, "secret_missing", "Client "+c.ClientID+" needs its client secret")
				return
			}
		}
		if gh == nil && gg == nil && oidc == nil {
			errJSON(w, 400, "no_provider", "Add at least one sign-in provider")
			return
		}
		if oidc != nil && !issuerOK.MatchString(oidc.Issuer) && !localhost.MatchString(oidc.Issuer) {
			errJSON(w, 400, "bad_issuer", "The issuer must be an https URL")
			return
		}
		var raw []any
		switch v := b["allowedEmails"].(type) {
		case []any:
			raw = v
		case string:
			for _, s := range splitRe.Split(v, -1) {
				raw = append(raw, s)
			}
		}
		emails := []string{}
		seen := map[string]bool{}
		for _, e := range raw {
			s := strings.ToLower(str(e, 320))
			if emailRe.MatchString(s) && !seen[s] {
				seen[s] = true
				emails = append(emails, s)
			}
		}
		next := auth.Setup{Providers: auth.Providers{GitHub: gh, Google: gg, OIDC: oidc}, AllowedEmails: emails, AdminUserID: admin, ConfiguredAt: time.Now().UTC().Format(time.RFC3339)}
		if err := o.Store.SetConfig(r.Context(), "setup", next); err != nil {
			serverError(w, err)
			return
		}
		if err := a.Load(r.Context()); err != nil {
			serverError(w, err)
			return
		}
		writeJSON(w, 200, Redact(a.Setup()))
	})

	// ---- library sync
	signedIn := func(h func(http.ResponseWriter, *http.Request, *auth.SessionUser)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			u := user(r)
			if u == nil {
				errJSON(w, 401, "signed_out", "")
				return
			}
			h(w, r, u)
		}
	}

	mux.HandleFunc("GET /api/library", signedIn(func(w http.ResponseWriter, r *http.Request, u *auth.SessionUser) {
		l, err := o.Store.GetLibrary(r.Context(), u.ID)
		if err != nil {
			serverError(w, err)
			return
		}
		if l == nil {
			w.WriteHeader(204)
			return
		}
		writeJSON(w, 200, l)
	}))

	mux.HandleFunc("PUT /api/library", signedIn(func(w http.ResponseWriter, r *http.Request, u *auth.SessionUser) {
		var b struct {
			BaseRev json.RawMessage `json:"baseRev"`
			Doc     json.RawMessage `json:"doc"`
		}
		if !readJSON(w, r, &b) {
			return
		}
		var base float64
		if json.Unmarshal(b.BaseRev, &base) != nil || base < 0 || base != float64(int64(base)) || !isDoc(b.Doc) {
			errJSON(w, 400, "bad_request", "Expected { baseRev, doc }")
			return
		}
		var doc bytes.Buffer
		if err := json.Compact(&doc, b.Doc); err != nil {
			errJSON(w, 400, "bad_request", "Expected { baseRev, doc }")
			return
		}
		res, err := o.Store.PutLibrary(r.Context(), u.ID, int64(base), doc.Bytes())
		if err != nil {
			serverError(w, err)
			return
		}
		if res.OK {
			writeJSON(w, 200, map[string]any{"rev": res.Rev, "updatedAt": res.UpdatedAt})
		} else {
			writeJSON(w, 409, map[string]any{"error": "conflict", "current": res.Current})
		}
	}))

	mux.HandleFunc("DELETE /api/library", signedIn(func(w http.ResponseWriter, r *http.Request, u *auth.SessionUser) {
		if err := o.Store.DeleteLibrary(r.Context(), u.ID); err != nil {
			serverError(w, err)
			return
		}
		w.WriteHeader(204)
	}))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { errJSON(w, 404, "not_found", "") })
	mux.Handle(auth.BasePath+"/", a)

	var static http.Handler = http.NotFoundHandler()
	if o.Static != nil {
		static = staticHandler(o.Static)
	}
	mux.Handle("/", static)

	site := gzhttp.GzipHandler(mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Del("X-Powered-By")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		if o.Bridge != nil && strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			o.Bridge.ServeHTTP(w, r)
			return
		}
		site.ServeHTTP(w, r)
	})
}

func serverError(w http.ResponseWriter, err error) {
	log.Printf("server error: %v", err)
	errJSON(w, 500, "error", "Server error")
}

func staticHandler(root fs.FS) http.Handler {
	files := http.FileServerFS(root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := path.Clean(r.URL.Path)
		switch {
		case p == "/" || noCache.MatchString(p):
			w.Header().Set("Cache-Control", "no-cache")
		case strings.HasPrefix(p, "/assets/"):
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		if strings.HasSuffix(p, ".webmanifest") {
			w.Header().Set("Content-Type", "application/manifest+json")
		}
		files.ServeHTTP(w, r)
	})
}
