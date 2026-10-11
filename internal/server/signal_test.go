package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func (e *env) dial(path string, header http.Header) (*websocket.Conn, *http.Response, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return websocket.Dial(ctx, "ws"+strings.TrimPrefix(e.base, "http")+path, &websocket.DialOptions{HTTPHeader: header})
}

func send(t *testing.T, c *websocket.Conn, v any) {
	t.Helper()
	b, _ := json.Marshal(v)
	if err := c.Write(context.Background(), websocket.MessageText, b); err != nil {
		t.Fatal(err)
	}
}

func recv(c *websocket.Conn, wait time.Duration) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	_, b, err := c.Read(ctx)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	return m, json.Unmarshal(b, &m)
}

func TestSignalNeedsSignIn(t *testing.T) {
	e := newEnv(t)
	e.setup(nil)
	if _, res, err := e.dial("/signal", nil); err == nil || res == nil || res.StatusCode != 401 {
		t.Fatalf("signed-out dial: want 401, got %v %v", res, err)
	}
	if r := e.req("GET", "/api/signal/token", nil, nil); r.status != 401 {
		t.Fatalf("token signed out: %d", r.status)
	}
	if r := e.req("GET", "/api/status", nil, nil); r.body["signal"] != "auth" {
		t.Fatalf("status.signal = %v", r.body["signal"])
	}
}

func TestSignalRelaysWithinOneAccount(t *testing.T) {
	e := newEnv(t)
	e.setup(nil)
	h := http.Header{}
	h.Set("Cookie", e.cookie("github:1")["Cookie"])
	h.Set("Origin", e.base)
	a, _, err := e.dial("/signal", h)
	if err != nil {
		t.Fatal(err)
	}
	defer a.CloseNow()
	// The same user from GitHub Pages: a token, any origin.
	tok := e.req("GET", "/api/signal/token", nil, e.cookie("github:1")).body["token"].(string)
	b, _, err := e.dial("/signal?token="+tok, http.Header{"Origin": {"https://adeelahmad.github.io"}})
	if err != nil {
		t.Fatal(err)
	}
	defer b.CloseNow()
	// Another account on the same topic hears nothing.
	other, _, err := e.dial("/signal?token="+e.a.SignalToken("github:2"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer other.CloseNow()
	for _, c := range []*websocket.Conn{a, b, other} {
		send(t, c, map[string]any{"type": "subscribe", "topics": []string{"room"}})
	}
	send(t, a, map[string]any{"type": "ping"})
	if m, err := recv(a, 2*time.Second); err != nil || m["type"] != "pong" {
		t.Fatalf("ping: %v %v", m, err)
	}
	send(t, a, map[string]any{"type": "publish", "topic": "room", "data": "sealed"})
	if m, err := recv(b, 2*time.Second); err != nil || m["data"] != "sealed" || m["topic"] != "room" {
		t.Fatalf("b got %v %v", m, err)
	}
	if m, err := recv(other, 300*time.Millisecond); err == nil {
		t.Fatalf("another account heard %v", m)
	}
}

func TestSignalCookieNeedsSameOrigin(t *testing.T) {
	e := newEnv(t)
	e.setup(nil)
	h := http.Header{}
	h.Set("Cookie", e.cookie("github:1")["Cookie"])
	h.Set("Origin", "https://evil.example")
	if _, _, err := e.dial("/signal", h); err == nil {
		t.Fatal("a cross-site page used the session cookie")
	}
}

func TestSignalConnectPage(t *testing.T) {
	e := newEnv(t)
	e.setup(nil)
	if r := e.req("GET", "/signal/connect?origin=https://evil.example", nil, nil); r.status != 403 {
		t.Fatalf("unknown origin: %d", r.status)
	}
	r := e.req("GET", "/signal/connect?origin=https://adeelahmad.github.io", nil, e.cookie("github:1"))
	if r.status != 200 || !strings.Contains(r.raw, "mock-signal") || !strings.Contains(r.raw, "postMessage") {
		t.Fatalf("connect page: %d %s", r.status, r.raw)
	}
	if tok := e.req("GET", "/api/signal/token", nil, e.cookie("github:1")).body["token"].(string); e.a.SignalUser(tok) != "github:1" {
		t.Fatal("token does not name the user")
	}
	if e.a.SignalUser("forged.token") != "" {
		t.Fatal("forged token accepted")
	}
}
