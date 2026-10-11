package meet

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// DefaultOrigins are the app's usual origins (dev, preview, GitHub Pages).
var DefaultOrigins = []string{"http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173", "https://adeelahmad.github.io"}

// BotRequest is what a bot needs: where, as whom, and where to send status and meeting audio.
type BotRequest struct {
	URL      string
	Name     string
	OnStatus func(s Status, message string)
	OnPCM    func(base64 string)
}

// Bot is what the bridge needs from a bot (tests pass a fake).
type Bot interface {
	Start(ctx context.Context) error
	Play(base64 string, rate float64)
	Flush()
	Tile(t Tile)
	Leave()
}

// Bridge is the WebSocket the app talks to: paired with a code, accepted only from the app's
// origins. It runs at most one bot: `join` starts it, meeting audio streams back to the app,
// interviewer audio and the tile go to the bot, and the bot leaves when the app says so or its
// tab disconnects.
type Bridge struct {
	Token   string
	Origins []string
	// SameOrigin also accepts the page this server serves (the app embedded in the binary).
	SameOrigin bool
	// AnyURL allows any http(s) meeting URL, not only meet.google.com (tests use a fake Meet page).
	AnyURL bool
	NewBot func(BotRequest) Bot
	Log    func(string)

	mu  sync.Mutex
	app *websocket.Conn
	bot Bot
}

// PairingCode is an "ABC-123"-style code, easy to read off a terminal.
func PairingCode() string {
	const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	pick := func() byte {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(A))))
		return A[n.Int64()]
	}
	b := make([]byte, 0, 7)
	for i := 0; i < 7; i++ {
		if i == 3 {
			b = append(b, '-')
		} else {
			b = append(b, pick())
		}
	}
	return string(b)
}

func (b *Bridge) log(s string) {
	if b.Log != nil {
		b.Log(s)
	}
}

func (b *Bridge) originOK(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	for _, a := range b.Origins {
		if o == a {
			return true
		}
	}
	if b.SameOrigin {
		if u, err := url.Parse(o); err == nil && strings.EqualFold(u.Host, r.Host) {
			return true
		}
	}
	return false
}

func send(ws *websocket.Conn, m BridgeMsg) {
	if ws == nil {
		return
	}
	data, _ := json.Marshal(m)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = ws.Write(ctx, websocket.MessageText, data)
}

func (b *Bridge) current() *websocket.Conn {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.app
}

func (b *Bridge) stopBot() {
	b.mu.Lock()
	bot := b.bot
	b.bot = nil
	b.mu.Unlock()
	if bot != nil {
		bot.Leave()
	}
}

// Close stops the bot and drops the app.
func (b *Bridge) Close() {
	b.stopBot()
	if ws := b.current(); ws != nil {
		ws.CloseNow()
	}
}

func (b *Bridge) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !b.originOK(r) {
		b.log("refused a connection from " + r.Header.Get("Origin"))
		http.Error(w, "Forbidden origin", http.StatusForbidden)
		return
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	ws.SetReadLimit(4 << 20)
	b.serve(ws)
}

func (b *Bridge) serve(ws *websocket.Conn) {
	ctx := context.Background()
	paired := false
	pairTimer := time.AfterFunc(5*time.Second, func() { ws.Close(4001, "No pairing code") })
	defer func() {
		pairTimer.Stop()
		b.mu.Lock()
		mine := b.app == ws
		if mine {
			b.app = nil
		}
		b.mu.Unlock()
		if mine {
			b.log("app disconnected · the bot leaves")
			b.stopBot()
		}
		ws.CloseNow()
	}()
	for {
		_, raw, err := ws.Read(ctx)
		if err != nil {
			return
		}
		m, ok := ParseClientMsg(raw)
		if !ok {
			continue
		}
		if !paired {
			if m.Type != "hello" {
				continue
			}
			pairTimer.Stop()
			if m.Token != b.Token {
				send(ws, BridgeMsg{Type: "error", Message: "Wrong pairing code"})
				ws.Close(4003, "Wrong pairing code")
				return
			}
			if m.Version != Version {
				send(ws, BridgeMsg{Type: "error", Message: fmt.Sprintf("Update the Meet bridge (protocol %v ≠ %d)", m.Version, Version)})
				ws.Close(4004, "Version mismatch")
				return
			}
			b.mu.Lock()
			busy := b.app != nil
			if !busy {
				b.app = ws
			}
			b.mu.Unlock()
			if busy {
				send(ws, BridgeMsg{Type: "error", Message: "Another Mock tab is using the bridge"})
				ws.Close(4009, "Busy")
				return
			}
			paired = true
			send(ws, BridgeMsg{Type: "welcome", Version: Version})
			b.log("app connected")
			continue
		}
		b.mu.Lock()
		bot := b.bot
		b.mu.Unlock()
		switch m.Type {
		case "join":
			b.join(m)
		case "play":
			if bot != nil {
				bot.Play(m.Data, m.Rate)
			}
		case "flush":
			if bot != nil {
				bot.Flush()
			}
		case "tile":
			if bot != nil {
				bot.Tile(m.Tile)
			}
		case "leave":
			go func() { b.stopBot(); send(b.current(), BridgeMsg{Type: "status", Status: Left}) }()
		}
	}
}

func (b *Bridge) join(m ClientMsg) {
	u := ""
	if b.AnyURL && (strings.HasPrefix(m.MeetingURL, "http://") || strings.HasPrefix(m.MeetingURL, "https://")) {
		u = m.MeetingURL
	} else {
		u = ParseMeetLink(m.MeetingURL)
	}
	if u == "" {
		send(b.current(), BridgeMsg{Type: "status", Status: Failed, Message: "Not a Google Meet link"})
		return
	}
	go func() {
		b.stopBot()
		b.log("joining " + u + " as " + m.BotName)
		var bot Bot
		isMine := func() bool { b.mu.Lock(); defer b.mu.Unlock(); return b.bot == bot && bot != nil }
		bot = b.NewBot(BotRequest{
			URL: u, Name: m.BotName,
			OnStatus: func(s Status, message string) {
				if isMine() {
					send(b.current(), BridgeMsg{Type: "status", Status: s, Message: message, MeetingURL: u})
					if message != "" {
						b.log("bot: " + string(s) + " · " + message)
					} else {
						b.log("bot: " + string(s))
					}
				}
			},
			OnPCM: func(data string) {
				if isMine() {
					send(b.current(), BridgeMsg{Type: "pcm", Data: data})
				}
			},
		})
		b.mu.Lock()
		b.bot = bot
		b.mu.Unlock()
		if err := bot.Start(context.Background()); err != nil && isMine() {
			msg, _, _ := strings.Cut(err.Error(), "\n")
			send(b.current(), BridgeMsg{Type: "status", Status: Failed, Message: msg})
			b.stopBot()
		}
	}()
}
