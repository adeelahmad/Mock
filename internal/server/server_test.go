package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/adeelahmad/mock/internal/auth"
	"github.com/adeelahmad/mock/internal/store"
)

const token = "setup-token-123"

type env struct {
	t    *testing.T
	st   *store.Store
	a    *auth.Auth
	base string
}

func newEnv(t *testing.T) *env {
	st, err := store.Open("", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	a := auth.New(st, "test-secret-test-secret-test-secret")
	if err := a.Load(context.Background()); err != nil {
		t.Fatal(err)
	}
	static := fstest.MapFS{"index.html": {Data: []byte("<!doctype html>app")}, "assets/a.js": {Data: []byte("x")}}
	srv := httptest.NewServer(New(Options{Store: st, Auth: a, SetupToken: token, Static: static, Version: "test"}))
	t.Cleanup(func() { srv.Close(); st.Close() })
	return &env{t: t, st: st, a: a, base: srv.URL}
}

type resp struct {
	status int
	body   map[string]any
	raw    string
	header http.Header
}

func (e *env) req(method, path string, body any, headers map[string]string) resp {
	e.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	q, _ := http.NewRequest(method, e.base+path, r)
	q.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		q.Header.Set(k, v)
	}
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := c.Do(q)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	return resp{res.StatusCode, m, string(raw), res.Header}
}

func (e *env) setup(body any) resp {
	if body == nil {
		body = map[string]any{"providers": map[string]any{"github": map[string]any{"clientId": "gh-id", "clientSecret": "gh-secret"}}, "allowedEmails": "Ada@Example.com, bad"}
	}
	return e.req("PUT", "/api/setup", body, map[string]string{"X-Setup-Token": token})
}

func (e *env) cookie(uid string) map[string]string {
	name, email := "Ada", "ada@example.com"
	return map[string]string{"Cookie": auth.SessionCookieName + "=" + e.a.SessionValue(uid, &name, &email)}
}

func doc(n int) map[string]any {
	return map[string]any{"app": "mock", "version": 1, "exportedAt": "2026-10-11T00:00:00Z", "tables": map[string]any{"lps": []any{}, "stories": []any{map[string]any{"id": "s" + string(rune('0'+n))}}, "settings": map[string]any{}}}
}

func jsonEq(t *testing.T, got, want any) {
	t.Helper()
	g, _ := json.Marshal(got)
	w, _ := json.Marshal(want)
	var gv, wv any
	_ = json.Unmarshal(g, &gv)
	_ = json.Unmarshal(w, &wv)
	gs, _ := json.Marshal(gv)
	ws, _ := json.Marshal(wv)
	if string(gs) != string(ws) {
		t.Fatalf("got  %s\nwant %s", gs, ws)
	}
}

func TestStartsUnconfiguredAndNeedsTheSetupToken(t *testing.T) {
	e := newEnv(t)
	s := e.req("GET", "/api/status", nil, nil)
	jsonEq(t, s.body, map[string]any{"server": true, "version": "test", "db": "sqlite", "configured": false, "providers": []any{}, "user": nil})
	if c := s.header.Get("Cache-Control"); c != "no-store" {
		t.Fatalf("api cache-control %q", c)
	}
	if r := e.req("POST", "/api/setup/verify", map[string]any{"token": "nope"}, nil); r.status != 403 {
		t.Fatal(r.status)
	}
	if r := e.req("POST", "/api/setup/verify", map[string]any{"token": token}, nil); r.status != 200 {
		t.Fatal(r.status)
	}
	if r := e.req("PUT", "/api/setup", map[string]any{"providers": map[string]any{"github": map[string]any{"clientId": "x", "clientSecret": "y"}}}, nil); r.status != 403 {
		t.Fatal(r.status)
	}
	if r := e.req("GET", "/auth/providers", nil, nil); r.status != 503 {
		t.Fatal(r.status)
	}
}

func TestSavesProvidersRedactsSecretsKeepsAnEmptySecret(t *testing.T) {
	e := newEnv(t)
	r := e.setup(nil)
	if r.status != 200 {
		t.Fatal(r.status, r.raw)
	}
	jsonEq(t, r.body, map[string]any{"configured": true, "providers": map[string]any{"github": map[string]any{"clientId": "gh-id", "hasSecret": true}, "google": nil, "oidc": nil}, "allowedEmails": []any{"ada@example.com"}, "hasAdmin": false})
	if strings.Contains(r.raw, "gh-secret") {
		t.Fatal("secret leaked")
	}
	again := e.setup(map[string]any{"providers": map[string]any{"github": map[string]any{"clientId": "gh-id", "clientSecret": ""}}, "allowedEmails": []any{}})
	if again.status != 200 || !again.body["providers"].(map[string]any)["github"].(map[string]any)["hasSecret"].(bool) {
		t.Fatal(again.raw)
	}
	var s auth.Setup
	if _, err := e.st.GetConfig(context.Background(), "setup", &s); err != nil || s.Providers.GitHub.ClientSecret != "gh-secret" {
		t.Fatal("secret not kept", err)
	}
	jsonEq(t, e.req("GET", "/api/status", nil, nil).body["providers"], []any{map[string]any{"id": "github", "name": "GitHub"}})
	p := e.req("GET", "/auth/providers", nil, nil)
	if p.status != 200 || !strings.HasSuffix(p.body["github"].(map[string]any)["callbackUrl"].(string), "/auth/callback/github") {
		t.Fatal(p.raw)
	}
	if g := e.req("GET", "/api/setup", nil, map[string]string{"X-Setup-Token": token}); g.status != 200 || strings.Contains(g.raw, "gh-secret") {
		t.Fatal(g.raw)
	}
}

func TestRejectsBadSetups(t *testing.T) {
	e := newEnv(t)
	for _, body := range []any{
		map[string]any{"providers": map[string]any{}},
		map[string]any{"providers": map[string]any{"google": map[string]any{"clientId": "g"}}},
		map[string]any{"providers": map[string]any{"oidc": map[string]any{"clientId": "o", "clientSecret": "s", "issuer": "http://evil.example.com"}}},
	} {
		if r := e.setup(body); r.status != 400 {
			t.Fatal(r.status, r.raw)
		}
	}
	r := e.setup(map[string]any{"providers": map[string]any{"oidc": map[string]any{"clientId": "o", "clientSecret": "s", "issuer": "https://id.example.com", "name": "Acme SSO"}}})
	jsonEq(t, r.body["providers"].(map[string]any)["oidc"], map[string]any{"clientId": "o", "hasSecret": true, "issuer": "https://id.example.com", "name": "Acme SSO"})
}

func TestLibraryNeedsASignedInUser(t *testing.T) {
	e := newEnv(t)
	e.setup(nil)
	if r := e.req("GET", "/api/library", nil, nil); r.status != 401 {
		t.Fatal(r.status)
	}
	if r := e.req("PUT", "/api/library", map[string]any{"baseRev": 0, "doc": doc(1)}, nil); r.status != 401 {
		t.Fatal(r.status)
	}
	s := e.req("GET", "/api/status", nil, e.cookie("github:42"))
	u := s.body["user"].(map[string]any)
	if u["id"] != "github:42" || u["email"] != "ada@example.com" || u["admin"] != false {
		t.Fatal(s.raw)
	}
}

func TestLibraryCompareAndSwap(t *testing.T) {
	e := newEnv(t)
	e.setup(nil)
	a, b := e.cookie("github:1"), e.cookie("github:2")
	if r := e.req("GET", "/api/library", nil, a); r.status != 204 {
		t.Fatal(r.status)
	}
	if r := e.req("PUT", "/api/library", map[string]any{"baseRev": 0, "doc": doc(1)}, a); r.body["rev"] != 1.0 {
		t.Fatal(r.raw)
	}
	if r := e.req("PUT", "/api/library", map[string]any{"baseRev": 1, "doc": doc(2)}, a); r.body["rev"] != 2.0 {
		t.Fatal(r.raw)
	}
	// A browser still on rev 1 loses and gets the current copy back.
	lost := e.req("PUT", "/api/library", map[string]any{"baseRev": 1, "doc": doc(9)}, a)
	if lost.status != 409 {
		t.Fatal(lost.status)
	}
	cur := lost.body["current"].(map[string]any)
	if cur["rev"] != 2.0 {
		t.Fatal(lost.raw)
	}
	jsonEq(t, cur["doc"], doc(2))
	got := e.req("GET", "/api/library", nil, a)
	jsonEq(t, got.body["doc"], doc(2))
	// A second insert at rev 0 loses too.
	if r := e.req("PUT", "/api/library", map[string]any{"baseRev": 0, "doc": doc(3)}, a); r.status != 409 {
		t.Fatal(r.status)
	}
	// Another user sees nothing of it.
	if r := e.req("GET", "/api/library", nil, b); r.status != 204 {
		t.Fatal(r.status)
	}
	if r := e.req("PUT", "/api/library", map[string]any{"baseRev": 0, "doc": map[string]any{"not": "mock"}}, b); r.status != 400 {
		t.Fatal(r.status)
	}
	if r := e.req("PUT", "/api/library", map[string]any{"baseRev": 1.5, "doc": doc(1)}, b); r.status != 400 {
		t.Fatal(r.status)
	}
	if r := e.req("DELETE", "/api/library", nil, a); r.status != 204 {
		t.Fatal(r.status)
	}
	if r := e.req("GET", "/api/library", nil, a); r.status != 204 {
		t.Fatal(r.status)
	}
}

func TestRejectsAForgedCookie(t *testing.T) {
	e := newEnv(t)
	e.setup(nil)
	other := auth.New(e.st, "another-secret-another-secret-xx")
	forged := map[string]string{"Cookie": auth.SessionCookieName + "=" + other.SessionValue("github:1", nil, nil)}
	if r := e.req("GET", "/api/library", nil, forged); r.status != 401 {
		t.Fatal(r.status)
	}
}

func TestServesTheApp(t *testing.T) {
	e := newEnv(t)
	r := e.req("GET", "/", nil, nil)
	if r.status != 200 || !strings.Contains(r.raw, "app") || r.header.Get("Cache-Control") != "no-cache" {
		t.Fatal(r.status, r.raw, r.header)
	}
	if r := e.req("GET", "/assets/a.js", nil, nil); r.header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatal(r.header)
	}
	if r := e.req("GET", "/api/nope", nil, nil); r.status != 404 || r.body["error"] != "not_found" {
		t.Fatal(r.raw)
	}
}
