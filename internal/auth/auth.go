// Package auth is the Mock server's sign-in: OAuth 2 / OpenID Connect with the clients the setup
// wizard stored (GitHub, Google and any OIDC issuer). It speaks the same small surface the app's
// Auth.js client used, under /auth:
//
//	GET  /auth/csrf                  { csrfToken } (double-submit cookie)
//	POST /auth/signin/{provider}     form: csrfToken, callbackUrl → redirect to the provider
//	GET  /auth/callback/{provider}   the provider's redirect back → session cookie → callbackUrl
//	POST /auth/signout               form: csrfToken, callbackUrl → clears the session
//	GET  /auth/session               the signed-in user, or null
//	GET  /auth/providers             the configured providers with their sign-in and callback URLs
//
// Sessions are HMAC-signed cookies carrying the account id `<provider>:<account id>`, which keys
// the user's library. The setup is reloaded whenever it changes, so a new client id takes effect
// without a restart.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/adeelahmad/mock/internal/store"
	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
)

const (
	BasePath      = "/auth"
	sessionCookie = "mock.session"
	csrfCookie    = "mock.csrf"
	flowCookie    = "mock.oauth"
	sessionMaxAge = 90 * 24 * time.Hour
	flowMaxAge    = 15 * time.Minute
)

type OAuthClient struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

type OIDCClient struct {
	OAuthClient
	Issuer string `json:"issuer"`
	Name   string `json:"name,omitempty"`
}

type Providers struct {
	GitHub *OAuthClient `json:"github,omitempty"`
	Google *OAuthClient `json:"google,omitempty"`
	OIDC   *OIDCClient  `json:"oidc,omitempty"`
}

type Setup struct {
	Providers Providers `json:"providers"`
	// Lower-case emails allowed to sign in; empty = anyone with an account at a configured provider.
	AllowedEmails []string `json:"allowedEmails"`
	// Who may change the setup after it is done: the first account to sign in.
	AdminUserID  *string `json:"adminUserId"`
	ConfiguredAt string  `json:"configuredAt"`
}

type ProviderInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type SessionUser struct {
	ID    string  `json:"id"`
	Name  *string `json:"name"`
	Email *string `json:"email"`
	Image *string `json:"image"`
	Admin bool    `json:"admin"`
}

// ProviderList is the sign-in buttons a setup offers.
func ProviderList(s *Setup) []ProviderInfo {
	out := []ProviderInfo{}
	if s == nil {
		return out
	}
	if s.Providers.GitHub != nil && s.Providers.GitHub.ClientID != "" {
		out = append(out, ProviderInfo{"github", "GitHub"})
	}
	if s.Providers.Google != nil && s.Providers.Google.ClientID != "" {
		out = append(out, ProviderInfo{"google", "Google"})
	}
	if o := s.Providers.OIDC; o != nil && o.ClientID != "" && o.Issuer != "" {
		name := o.Name
		if name == "" {
			name = "Single sign-on"
		}
		out = append(out, ProviderInfo{"oidc", name})
	}
	return out
}

// RandomToken is a URL-safe random string of n bytes.
func RandomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// Secret is AUTH_SECRET, else one generated once and kept in the config table.
func Secret(ctx context.Context, st *store.Store, env string) (string, error) {
	if env != "" {
		return env, nil
	}
	var kept string
	if ok, err := st.GetConfig(ctx, "auth.secret", &kept); err != nil {
		return "", err
	} else if ok && kept != "" {
		return kept, nil
	}
	s := RandomToken(32)
	return s, st.SetConfig(ctx, "auth.secret", s)
}

type Auth struct {
	store  *store.Store
	secret []byte
	// PublicURL is AUTH_URL: the public origin when a proxy hides it ("" = from the request).
	PublicURL string
	// HTTPClient talks to the providers (tests swap it).
	HTTPClient *http.Client
	// Endpoint overrides, for tests: provider id → endpoint.
	Endpoints map[string]oauth2.Endpoint
	// GitHubAPI is the GitHub REST base (tests swap it).
	GitHubAPI string

	mu    sync.RWMutex
	setup *Setup
	oidc  map[string]*oidc.Provider
}

func New(st *store.Store, secret string) *Auth {
	return &Auth{store: st, secret: []byte(secret), HTTPClient: &http.Client{Timeout: 20 * time.Second}, GitHubAPI: "https://api.github.com", oidc: map[string]*oidc.Provider{}}
}

// Load re-reads the setup from the store.
func (a *Auth) Load(ctx context.Context) error {
	var s Setup
	ok, err := a.store.GetConfig(ctx, "setup", &s)
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if ok {
		a.setup = &s
	} else {
		a.setup = nil
	}
	return nil
}

// Setup is the current setup (nil before the wizard ran). Callers must not modify it.
func (a *Auth) Setup() *Setup {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.setup
}

func (a *Auth) configured() bool { return len(ProviderList(a.Setup())) > 0 }

// ---- signed values

func (a *Auth) sign(v any, ttl time.Duration) string {
	body, _ := json.Marshal(struct {
		V   any   `json:"v"`
		Exp int64 `json:"exp"`
	}{v, time.Now().Add(ttl).Unix()})
	p := base64.RawURLEncoding.EncodeToString(body)
	m := hmac.New(sha256.New, a.secret)
	m.Write([]byte(p))
	return p + "." + base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (a *Auth) verify(token string, v any) bool {
	p, sig, ok := strings.Cut(token, ".")
	if !ok {
		return false
	}
	m := hmac.New(sha256.New, a.secret)
	m.Write([]byte(p))
	want := m.Sum(nil)
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(want, got) {
		return false
	}
	body, err := base64.RawURLEncoding.DecodeString(p)
	if err != nil {
		return false
	}
	var env struct {
		V   json.RawMessage `json:"v"`
		Exp int64           `json:"exp"`
	}
	if json.Unmarshal(body, &env) != nil || time.Now().Unix() > env.Exp {
		return false
	}
	return json.Unmarshal(env.V, v) == nil
}

type session struct {
	UID   string  `json:"uid"`
	Name  *string `json:"name"`
	Email *string `json:"email"`
	Image *string `json:"image"`
}

// SessionValue is a session cookie value for uid (tests sign in with it).
func (a *Auth) SessionValue(uid string, name, email *string) string {
	return a.sign(session{UID: uid, Name: name, Email: email}, sessionMaxAge)
}

// SessionCookieName is the cookie the session travels in.
const SessionCookieName = sessionCookie

// User is the signed-in user, or nil.
func (a *Auth) User(r *http.Request) *SessionUser {
	if !a.configured() {
		return nil
	}
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil
	}
	var s session
	if !a.verify(c.Value, &s) || s.UID == "" {
		return nil
	}
	setup := a.Setup()
	admin := setup != nil && setup.AdminUserID != nil && *setup.AdminUserID == s.UID
	return &SessionUser{ID: s.UID, Name: s.Name, Email: s.Email, Image: s.Image, Admin: admin}
}

// ---- URLs

func secureReq(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(firstHeader(r, "X-Forwarded-Proto"), "https")
}

func firstHeader(r *http.Request, k string) string {
	v, _, _ := strings.Cut(r.Header.Get(k), ",")
	return strings.TrimSpace(v)
}

// origin is the public origin: AUTH_URL, else the request's (behind a trusted proxy).
func (a *Auth) origin(r *http.Request) string {
	if a.PublicURL != "" {
		return strings.TrimRight(a.PublicURL, "/")
	}
	scheme := "http"
	if secureReq(r) {
		scheme = "https"
	}
	host := firstHeader(r, "X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	return scheme + "://" + host
}

func (a *Auth) callbackURL(r *http.Request, provider string) string {
	return a.origin(r) + BasePath + "/callback/" + provider
}

// safeRedirect keeps redirects on this site: anything else becomes the site root.
func (a *Auth) safeRedirect(r *http.Request, target string) string {
	base := a.origin(r)
	b, _ := url.Parse(base + "/")
	if target == "" {
		return b.String()
	}
	u, err := b.Parse(target)
	if err != nil || u.Scheme != b.Scheme || u.Host != b.Host {
		return b.String()
	}
	return u.String()
}

// ---- cookies

func (a *Auth) setCookie(w http.ResponseWriter, r *http.Request, name, value string, maxAge time.Duration) {
	c := &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secureReq(r)}
	if maxAge < 0 {
		c.MaxAge = -1
	} else {
		c.MaxAge = int(maxAge.Seconds())
	}
	http.SetCookie(w, c)
}

func (a *Auth) csrf(w http.ResponseWriter, r *http.Request) string {
	if c, err := r.Cookie(csrfCookie); err == nil {
		var t string
		if a.verify(c.Value, &t) && t != "" {
			return t
		}
	}
	t := RandomToken(24)
	a.setCookie(w, r, csrfCookie, a.sign(t, sessionMaxAge), sessionMaxAge)
	return t
}

func (a *Auth) csrfOK(r *http.Request) bool {
	c, err := r.Cookie(csrfCookie)
	if err != nil {
		return false
	}
	var t string
	if !a.verify(c.Value, &t) || t == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(t), []byte(r.PostFormValue("csrfToken"))) == 1
}

// ---- HTTP

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// ServeHTTP handles everything under /auth.
func (a *Auth) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !a.configured() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "not_configured", "message": "Sign-in is not set up yet"})
		return
	}
	path := strings.TrimPrefix(r.URL.Path, BasePath)
	switch {
	case path == "/csrf" && r.Method == http.MethodGet:
		writeJSON(w, 200, map[string]string{"csrfToken": a.csrf(w, r)})
	case path == "/session" && r.Method == http.MethodGet:
		if u := a.User(r); u != nil {
			writeJSON(w, 200, map[string]any{"user": u, "expires": time.Now().Add(sessionMaxAge).UTC().Format(time.RFC3339)})
		} else {
			writeJSON(w, 200, nil)
		}
	case path == "/providers" && r.Method == http.MethodGet:
		out := map[string]any{}
		for _, p := range ProviderList(a.Setup()) {
			typ := "oauth"
			if p.ID != "github" {
				typ = "oidc"
			}
			out[p.ID] = map[string]string{"id": p.ID, "name": p.Name, "type": typ, "signinUrl": a.origin(r) + BasePath + "/signin/" + p.ID, "callbackUrl": a.callbackURL(r, p.ID)}
		}
		writeJSON(w, 200, out)
	case strings.HasPrefix(path, "/signin/") && r.Method == http.MethodPost:
		a.signIn(w, r, strings.TrimPrefix(path, "/signin/"))
	case strings.HasPrefix(path, "/callback/") && r.Method == http.MethodGet:
		a.callback(w, r, strings.TrimPrefix(path, "/callback/"))
	case path == "/signout" && r.Method == http.MethodPost:
		if !a.csrfOK(r) {
			a.fail(w, r, "MissingCSRF")
			return
		}
		a.setCookie(w, r, sessionCookie, "", -1)
		http.Redirect(w, r, a.safeRedirect(r, r.PostFormValue("callbackUrl")), http.StatusFound)
	case path == "/error":
		a.errorPage(w, r)
	default:
		writeJSON(w, 404, map[string]string{"error": "not_found"})
	}
}

type flow struct {
	Provider    string `json:"p"`
	State       string `json:"s"`
	Verifier    string `json:"v"`
	Nonce       string `json:"n"`
	CallbackURL string `json:"c"`
}

func (a *Auth) client(ctx context.Context, r *http.Request, id string) (*oauth2.Config, *oidc.Provider, error) {
	s := a.Setup()
	var c *OAuthClient
	var issuer string
	scopes := []string{oidc.ScopeOpenID, "email", "profile"}
	switch id {
	case "github":
		c = s.Providers.GitHub
		scopes = []string{"read:user", "user:email"}
	case "google":
		c = s.Providers.Google
		issuer = "https://accounts.google.com"
	case "oidc":
		if s.Providers.OIDC != nil {
			c = &s.Providers.OIDC.OAuthClient
			issuer = s.Providers.OIDC.Issuer
		}
	}
	if c == nil || c.ClientID == "" {
		return nil, nil, errors.New("unknown provider")
	}
	cfg := &oauth2.Config{ClientID: c.ClientID, ClientSecret: c.ClientSecret, RedirectURL: a.callbackURL(r, id), Scopes: scopes}
	var prov *oidc.Provider
	if id == "github" {
		cfg.Endpoint = github.Endpoint
	} else {
		p, err := a.provider(ctx, issuer)
		if err != nil {
			return nil, nil, err
		}
		prov, cfg.Endpoint = p, p.Endpoint()
	}
	if e, ok := a.Endpoints[id]; ok {
		cfg.Endpoint = e
	}
	return cfg, prov, nil
}

func (a *Auth) provider(ctx context.Context, issuer string) (*oidc.Provider, error) {
	a.mu.RLock()
	p := a.oidc[issuer]
	a.mu.RUnlock()
	if p != nil {
		return p, nil
	}
	p, err := oidc.NewProvider(oidc.ClientContext(ctx, a.HTTPClient), issuer)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	a.oidc[issuer] = p
	a.mu.Unlock()
	return p, nil
}

func (a *Auth) signIn(w http.ResponseWriter, r *http.Request, id string) {
	if !a.csrfOK(r) {
		a.fail(w, r, "MissingCSRF")
		return
	}
	cfg, _, err := a.client(r.Context(), r, id)
	if err != nil {
		log.Printf("auth: sign-in with %s: %v", id, err)
		a.fail(w, r, "Configuration")
		return
	}
	f := flow{Provider: id, State: RandomToken(16), Verifier: oauth2.GenerateVerifier(), Nonce: RandomToken(16), CallbackURL: a.safeRedirect(r, r.PostFormValue("callbackUrl"))}
	a.setCookie(w, r, flowCookie, a.sign(f, flowMaxAge), flowMaxAge)
	opts := []oauth2.AuthCodeOption{oauth2.S256ChallengeOption(f.Verifier)}
	if id != "github" {
		opts = append(opts, oidc.Nonce(f.Nonce))
	}
	http.Redirect(w, r, cfg.AuthCodeURL(f.State, opts...), http.StatusFound)
}

type profile struct {
	id, email, name, image string
}

func (a *Auth) callback(w http.ResponseWriter, r *http.Request, id string) {
	ctx := oidc.ClientContext(r.Context(), a.HTTPClient)
	ctx = context.WithValue(ctx, oauth2.HTTPClient, a.HTTPClient)
	var f flow
	c, err := r.Cookie(flowCookie)
	if err != nil || !a.verify(c.Value, &f) || f.Provider != id || f.State == "" || subtle.ConstantTimeCompare([]byte(f.State), []byte(r.URL.Query().Get("state"))) != 1 {
		a.fail(w, r, "Verification")
		return
	}
	a.setCookie(w, r, flowCookie, "", -1)
	if e := r.URL.Query().Get("error"); e != "" {
		a.fail(w, r, "AccessDenied")
		return
	}
	cfg, prov, err := a.client(ctx, r, id)
	if err != nil {
		a.fail(w, r, "Configuration")
		return
	}
	tok, err := cfg.Exchange(ctx, r.URL.Query().Get("code"), oauth2.VerifierOption(f.Verifier))
	if err != nil {
		log.Printf("auth: %s token exchange: %v", id, err)
		a.fail(w, r, "OAuthCallback")
		return
	}
	var p profile
	if id == "github" {
		p, err = a.githubProfile(ctx, tok)
	} else {
		p, err = oidcProfile(ctx, prov, cfg, tok, f.Nonce)
	}
	if err != nil || p.id == "" {
		log.Printf("auth: %s profile: %v", id, err)
		a.fail(w, r, "OAuthCallback")
		return
	}
	setup := a.Setup()
	if len(setup.AllowedEmails) > 0 {
		email := strings.ToLower(p.email)
		allowed := false
		for _, e := range setup.AllowedEmails {
			allowed = allowed || (email != "" && e == email)
		}
		if !allowed {
			a.fail(w, r, "AccessDenied")
			return
		}
	}
	opt := func(s string) *string {
		if s == "" {
			return nil
		}
		return &s
	}
	uid := id + ":" + p.id
	if _, err := a.store.UpsertUser(r.Context(), store.User{ID: uid, Provider: id, Email: opt(p.email), Name: opt(p.name), Image: opt(p.image)}); err != nil {
		log.Printf("auth: saving user: %v", err)
		a.fail(w, r, "Configuration")
		return
	}
	if err := a.claimAdmin(r.Context(), uid); err != nil {
		log.Printf("auth: admin: %v", err)
	}
	a.setCookie(w, r, sessionCookie, a.sign(session{UID: uid, Name: opt(p.name), Email: opt(p.email), Image: opt(p.image)}, sessionMaxAge), sessionMaxAge)
	http.Redirect(w, r, a.safeRedirect(r, f.CallbackURL), http.StatusFound)
}

// claimAdmin makes uid the admin when nobody is yet.
func (a *Auth) claimAdmin(ctx context.Context, uid string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	var s Setup
	if ok, err := a.store.GetConfig(ctx, "setup", &s); err != nil || !ok || s.AdminUserID != nil {
		return err
	}
	s.AdminUserID = &uid
	if err := a.store.SetConfig(ctx, "setup", s); err != nil {
		return err
	}
	a.setup = &s
	return nil
}

func (a *Auth) githubProfile(ctx context.Context, tok *oauth2.Token) (profile, error) {
	hc := oauth2.NewClient(ctx, oauth2.StaticTokenSource(tok))
	get := func(path string, v any) error {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, a.GitHubAPI+path, nil)
		req.Header.Set("Accept", "application/vnd.github+json")
		res, err := hc.Do(req)
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			return fmt.Errorf("GET %s: %s", path, res.Status)
		}
		return json.NewDecoder(res.Body).Decode(v)
	}
	var u struct {
		ID     int64  `json:"id"`
		Login  string `json:"login"`
		Name   string `json:"name"`
		Email  string `json:"email"`
		Avatar string `json:"avatar_url"`
	}
	if err := get("/user", &u); err != nil {
		return profile{}, err
	}
	if u.Email == "" {
		var emails []struct {
			Email    string `json:"email"`
			Primary  bool   `json:"primary"`
			Verified bool   `json:"verified"`
		}
		if get("/user/emails", &emails) == nil {
			for _, e := range emails {
				if e.Primary && e.Verified {
					u.Email = e.Email
				}
			}
		}
	}
	name := u.Name
	if name == "" {
		name = u.Login
	}
	return profile{id: strconv.FormatInt(u.ID, 10), email: u.Email, name: name, image: u.Avatar}, nil
}

func oidcProfile(ctx context.Context, prov *oidc.Provider, cfg *oauth2.Config, tok *oauth2.Token, nonce string) (profile, error) {
	raw, _ := tok.Extra("id_token").(string)
	if raw == "" {
		return profile{}, errors.New("no id_token")
	}
	idt, err := prov.Verifier(&oidc.Config{ClientID: cfg.ClientID}).Verify(ctx, raw)
	if err != nil {
		return profile{}, err
	}
	if idt.Nonce != nonce {
		return profile{}, errors.New("nonce mismatch")
	}
	var c struct {
		Sub     string `json:"sub"`
		Email   string `json:"email"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := idt.Claims(&c); err != nil {
		return profile{}, err
	}
	if c.Email == "" || c.Name == "" {
		if ui, err := prov.UserInfo(ctx, oauth2.StaticTokenSource(tok)); err == nil {
			var more struct {
				Name    string `json:"name"`
				Picture string `json:"picture"`
			}
			_ = ui.Claims(&more)
			if c.Email == "" {
				c.Email = ui.Email
			}
			if c.Name == "" {
				c.Name = more.Name
			}
			if c.Picture == "" {
				c.Picture = more.Picture
			}
		}
	}
	return profile{id: c.Sub, email: c.Email, name: c.Name, image: c.Picture}, nil
}

func (a *Auth) fail(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, a.origin(r)+BasePath+"/error?error="+url.QueryEscape(code), http.StatusFound)
}

var errorText = map[string]string{
	"AccessDenied":  "This account is not allowed to sign in here. Ask the admin to add your email.",
	"Verification":  "The sign-in link expired or was already used. Try again.",
	"MissingCSRF":   "The sign-in form expired. Go back and try again.",
	"OAuthCallback": "The sign-in provider did not complete the sign-in. Try again.",
	"Configuration": "Sign-in is not set up correctly. Check the client ID and secret in the setup.",
}

// robotMark is the brand kit's robot (dark-surface colours), inline so the page needs no assets.
const robotMark = `<svg width="56" height="56" viewBox="0 25 56 61" aria-hidden="true"><path d="M28.05 37.9V32.3" stroke="#8AB4F8" stroke-width="4" stroke-linecap="round"/><circle cx="28.05" cy="29.7" r="4.1" fill="#F9AB00"/><rect x="1.5" y="51.1" width="5.5" height="15" rx="2.75" fill="#8AB4F8"/><rect x="49.1" y="51.1" width="4.5" height="15" rx="2.25" fill="#8AB4F8"/><rect x="4" y="37.9" width="48.1" height="46.2" rx="13" fill="#8AB4F8"/><rect x="10" y="44.3" width="36.1" height="30.8" rx="8.5" fill="#E8F0FE"/><rect x="16.1" y="51.7" width="5.9" height="7.9" rx="2.95" fill="#202124"/><rect x="34.1" y="51.7" width="5.9" height="7.9" rx="2.95" fill="#202124"/><path d="M23.1 66.5Q28.05 71 33 66.5" fill="none" stroke="#202124" stroke-width="2.8" stroke-linecap="round"/></svg>`

func (a *Auth) errorPage(w http.ResponseWriter, r *http.Request) {
	msg, ok := errorText[r.URL.Query().Get("error")]
	if !ok {
		msg = "Sign-in failed. Try again."
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusForbidden)
	fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign-in failed · Mock</title>
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<body style="font:16px 'DM Sans',system-ui,sans-serif;background:#18191B;color:#E8EAED;display:grid;place-items:center;min-height:90vh"><main style="max-width:28rem">%s<h1 style="letter-spacing:-.025em">Sign-in failed.</h1><p style="color:#9AA0A6">%s</p><p><a style="color:#8AB4F8;font-weight:700" href="%s">Back to Mock</a></p></main>`,
		robotMark, html.EscapeString(msg), html.EscapeString(a.origin(r)+"/"))
}
