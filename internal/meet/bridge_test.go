package meet

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

const origin = "http://localhost:5173"

type fakeBot struct {
	r       BotRequest
	mu      sync.Mutex
	played  []string
	tiles   []Tile
	flushes int
	left    bool
}

func (f *fakeBot) Start(context.Context) error {
	f.r.OnStatus(Launching, "")
	f.r.OnStatus(Joining, "")
	f.r.OnStatus(InCall, "")
	return nil
}
func (f *fakeBot) Play(d string, rate float64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.played = append(f.played, d)
}
func (f *fakeBot) Flush()      { f.mu.Lock(); f.flushes++; f.mu.Unlock() }
func (f *fakeBot) Tile(t Tile) { f.mu.Lock(); f.tiles = append(f.tiles, t); f.mu.Unlock() }
func (f *fakeBot) Leave()      { f.mu.Lock(); f.left = true; f.mu.Unlock() }
func (f *fakeBot) is(p func(*fakeBot) bool) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return p(f)
}

type rig struct {
	url  string
	mu   sync.Mutex
	bots []*fakeBot
}

func (r *rig) last() *fakeBot {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.bots) == 0 {
		return nil
	}
	return r.bots[len(r.bots)-1]
}

func newRig(t *testing.T) *rig {
	r := &rig{}
	b := &Bridge{Token: "ABC-123", Origins: []string{origin}, NewBot: func(req BotRequest) Bot {
		f := &fakeBot{r: req}
		r.mu.Lock()
		r.bots = append(r.bots, f)
		r.mu.Unlock()
		return f
	}}
	s := httptest.NewServer(b)
	t.Cleanup(func() { b.Close(); s.Close() })
	r.url = "ws://" + strings.TrimPrefix(s.URL, "http://")
	return r
}

type client struct {
	t  *testing.T
	ws *websocket.Conn
	in chan BridgeMsg
}

func dial(t *testing.T, url, from string) (*client, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {from}}})
	if err != nil {
		return nil, err
	}
	c := &client{t: t, ws: ws, in: make(chan BridgeMsg, 64)}
	go func() {
		defer close(c.in)
		for {
			_, data, err := ws.Read(context.Background())
			if err != nil {
				return
			}
			var m BridgeMsg
			_ = json.Unmarshal(data, &m)
			c.in <- m
		}
	}()
	t.Cleanup(func() { ws.CloseNow() })
	return c, nil
}

func (c *client) send(m any) {
	b, _ := json.Marshal(m)
	if err := c.ws.Write(context.Background(), websocket.MessageText, b); err != nil {
		c.t.Fatal(err)
	}
}

// next is the next message matching p (others skipped); ok=false when the socket closed or timed out.
func (c *client) next(p func(BridgeMsg) bool) (BridgeMsg, bool) {
	timeout := time.After(3 * time.Second)
	for {
		select {
		case m, ok := <-c.in:
			if !ok {
				return BridgeMsg{}, false
			}
			if p(m) {
				return m, true
			}
		case <-timeout:
			return BridgeMsg{}, false
		}
	}
}

func until(t *testing.T, p func() bool) {
	t.Helper()
	for end := time.Now().Add(3 * time.Second); time.Now().Before(end); time.Sleep(5 * time.Millisecond) {
		if p() {
			return
		}
	}
	t.Fatal("timeout")
}

func pair(t *testing.T, r *rig) *client {
	c, err := dial(t, r.url, origin)
	if err != nil {
		t.Fatal(err)
	}
	c.send(map[string]any{"type": "hello", "token": "ABC-123", "version": Version})
	if m, ok := c.next(func(m BridgeMsg) bool { return true }); !ok || m.Type != "welcome" || m.Version != Version {
		t.Fatalf("no welcome: %+v", m)
	}
	return c
}

func TestPairsJoinsRelaysAudioAndLeavesOnDisconnect(t *testing.T) {
	r := newRig(t)
	c := pair(t, r)
	c.send(map[string]any{"type": "join", "meetingUrl": "meet.google.com/abc-defg-hij", "botName": "Mock · Interviewer"})
	m, ok := c.next(func(m BridgeMsg) bool { return m.Type == "status" && m.Status == InCall })
	if !ok || m.MeetingURL != "https://meet.google.com/abc-defg-hij" {
		t.Fatalf("%+v", m)
	}
	bot := r.last()
	if bot.r.URL != "https://meet.google.com/abc-defg-hij" {
		t.Fatal(bot.r.URL)
	}
	bot.r.OnPCM("MEETING")
	if m, ok := c.next(func(m BridgeMsg) bool { return m.Type == "pcm" }); !ok || m.Data != "MEETING" {
		t.Fatalf("%+v", m)
	}
	c.send(map[string]any{"type": "play", "data": "VOICE", "rate": 24000})
	c.send(map[string]any{"type": "flush"})
	c.send(map[string]any{"type": "tile", "tile": map[string]any{"name": "Dana", "mono": "DW", "role": "Bar Raiser", "phase": "Asking", "question": "Q", "lp": "Ownership"}})
	until(t, func() bool { return bot.is(func(f *fakeBot) bool { return len(f.tiles) == 1 }) })
	if !bot.is(func(f *fakeBot) bool { return len(f.played) == 1 && f.played[0] == "VOICE" && f.flushes == 1 }) {
		t.Fatal("audio not relayed")
	}
	c.ws.Close(websocket.StatusNormalClosure, "")
	until(t, func() bool { return bot.is(func(f *fakeBot) bool { return f.left }) })
}

func TestRefusesWrongCodeOtherOriginAndNonMeetLinks(t *testing.T) {
	r := newRig(t)
	bad, err := dial(t, r.url, origin)
	if err != nil {
		t.Fatal(err)
	}
	bad.send(map[string]any{"type": "hello", "token": "nope", "version": Version})
	if m, _ := bad.next(func(BridgeMsg) bool { return true }); !strings.Contains(m.Message, "Wrong pairing code") {
		t.Fatalf("%+v", m)
	}
	if _, err := dial(t, r.url, "https://evil.example"); err == nil {
		t.Fatal("another origin connected")
	}
	c := pair(t, r)
	c.send(map[string]any{"type": "join", "meetingUrl": "https://evil.example/abc-defg-hij", "botName": "Mock"})
	m, ok := c.next(func(m BridgeMsg) bool { return m.Type == "status" })
	if !ok || m.Status != Failed || !strings.Contains(m.Message, "Not a Google Meet link") || r.last() != nil {
		t.Fatalf("%+v", m)
	}
}

func TestOnlyOneAppTabDrivesTheBot(t *testing.T) {
	r := newRig(t)
	pair(t, r)
	b, err := dial(t, r.url, origin)
	if err != nil {
		t.Fatal(err)
	}
	b.send(map[string]any{"type": "hello", "token": "ABC-123", "version": Version})
	if m, _ := b.next(func(BridgeMsg) bool { return true }); !strings.Contains(m.Message, "Another Mock tab") {
		t.Fatalf("%+v", m)
	}
}

func TestParsing(t *testing.T) {
	for in, want := range map[string]string{
		"abc-defg-hij":                             "https://meet.google.com/abc-defg-hij",
		"meet.google.com/ABC-defg-hij?authuser=1":  "https://meet.google.com/abc-defg-hij",
		"https://meet.google.com/abc-defg-hij#x":   "https://meet.google.com/abc-defg-hij",
		"https://evil.example/abc-defg-hij":        "",
		"https://meet.google.com.evil/abc-defg-hij": "",
	} {
		if got := ParseMeetLink(in); got != want {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
	if _, ok := ParseClientMsg([]byte(`{"type":"play","data":"x","rate":4000}`)); ok {
		t.Error("rate out of range accepted")
	}
	if _, ok := ParseClientMsg([]byte(`{"type":"tile","tile":{"name":"a"}}`)); ok {
		t.Error("partial tile accepted")
	}
	if m, ok := ParseClientMsg([]byte(`{"type":"hello","token":"T","version":1}`)); !ok || m.Token != "T" {
		t.Error("hello rejected")
	}
	if c := PairingCode(); len(c) != 7 || c[3] != '-' {
		t.Error(c)
	}
}
