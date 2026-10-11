package server

import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"golang.org/x/oauth2"
)

// A fake GitHub: authorize redirects straight back with a code, the token endpoint trades it,
// /user and /user/emails describe Ada.
func fakeGitHub(t *testing.T, email string) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/login/oauth/authorize", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("code_challenge") == "" || q.Get("client_id") != "gh-id" {
			t.Errorf("authorize: %v", q)
		}
		http.Redirect(w, r, q.Get("redirect_uri")+"?code=the-code&state="+url.QueryEscape(q.Get("state")), http.StatusFound)
	})
	mux.HandleFunc("/login/oauth/access_token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.PostForm.Get("code") != "the-code" || r.PostForm.Get("code_verifier") == "" {
			http.Error(w, "bad", 400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"tok","token_type":"bearer"}`))
	})
	mux.HandleFunc("/user", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			http.Error(w, "no", 401)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": 42, "login": "ada", "name": "Ada", "email": nil, "avatar_url": "https://img/ada"})
	})
	mux.HandleFunc("/user/emails", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]map[string]any{{"email": email, "primary": true, "verified": true}})
	})
	s := httptest.NewServer(mux)
	t.Cleanup(s.Close)
	return s
}

func signIn(t *testing.T, e *env, gh *httptest.Server) (*http.Client, *http.Response) {
	e.a.Endpoints = map[string]oauth2.Endpoint{"github": {AuthURL: gh.URL + "/login/oauth/authorize", TokenURL: gh.URL + "/login/oauth/access_token"}}
	e.a.GitHubAPI = gh.URL
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar}
	res, err := c.Get(e.base + "/auth/csrf")
	if err != nil {
		t.Fatal(err)
	}
	var csrf struct {
		CsrfToken string `json:"csrfToken"`
	}
	_ = json.NewDecoder(res.Body).Decode(&csrf)
	res.Body.Close()
	res, err = c.PostForm(e.base+"/auth/signin/github", url.Values{"csrfToken": {csrf.CsrfToken}, "callbackUrl": {e.base + "/#/practice"}})
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return c, res
}

func TestGitHubSignInMakesTheFirstUserAdmin(t *testing.T) {
	e := newEnv(t)
	e.setup(nil) // allows ada@example.com
	c, res := signIn(t, e, fakeGitHub(t, "Ada@Example.com"))
	if res.StatusCode != 200 || res.Request.URL.Path != "/" {
		t.Fatalf("landed on %s (%d)", res.Request.URL, res.StatusCode)
	}
	res, _ = c.Get(e.base + "/api/status")
	var s struct {
		User map[string]any `json:"user"`
	}
	_ = json.NewDecoder(res.Body).Decode(&s)
	res.Body.Close()
	if s.User["id"] != "github:42" || s.User["admin"] != true || s.User["name"] != "Ada" {
		t.Fatalf("user %v", s.User)
	}
	u, _ := e.st.GetUser(t.Context(), "github:42")
	if u == nil || *u.Email != "Ada@Example.com" {
		t.Fatalf("stored %v", u)
	}
	// Sign out clears the session.
	res, _ = c.Get(e.base + "/auth/csrf")
	var csrf struct{ CsrfToken string }
	_ = json.NewDecoder(res.Body).Decode(&csrf)
	res.Body.Close()
	res, _ = c.PostForm(e.base+"/auth/signout", url.Values{"csrfToken": {csrf.CsrfToken}, "callbackUrl": {"https://evil.example/"}})
	res.Body.Close()
	if res.Request.URL.Host != strings.TrimPrefix(e.base, "http://") {
		t.Fatalf("redirected off-site to %s", res.Request.URL)
	}
	res, _ = c.Get(e.base + "/api/library")
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatal(res.StatusCode)
	}
}

func TestSignInRefusesEmailsOffTheList(t *testing.T) {
	e := newEnv(t)
	e.setup(nil)
	_, res := signIn(t, e, fakeGitHub(t, "eve@example.com"))
	if res.StatusCode != 403 || res.Request.URL.Path != "/auth/error" || res.Request.URL.Query().Get("error") != "AccessDenied" {
		t.Fatalf("%d %s", res.StatusCode, res.Request.URL)
	}
}

func TestSignInNeedsTheCSRFToken(t *testing.T) {
	e := newEnv(t)
	e.setup(nil)
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, _ := c.PostForm(e.base+"/auth/signin/github", url.Values{"csrfToken": {"forged"}})
	res.Body.Close()
	if loc := res.Header.Get("Location"); !strings.Contains(loc, "error=MissingCSRF") {
		t.Fatal(loc)
	}
}
