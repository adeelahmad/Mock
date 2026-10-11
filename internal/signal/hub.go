// Package signal is the WebRTC signaling relay for passphrase sync (src/vault). Browsers that
// share a vault meet here before they connect directly; the relay only forwards small messages
// that are already encrypted with the vault key, on topics derived from it.
//
// The protocol is y-webrtc's pub/sub, as JSON text frames:
//
//	{"type":"subscribe","topics":["…"]}     {"type":"unsubscribe","topics":["…"]}
//	{"type":"publish","topic":"…","data":"…"}   → to every other subscriber of the topic
//	{"type":"ping"}                         → {"type":"pong"}
//
// Every connection belongs to a scope (the signed-in user, or "" on an open relay): topics never
// cross scopes, so one account's devices only ever see each other.
package signal

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	MaxMessage   = 128 << 10
	MaxTopics    = 16
	rateWindow   = 10 * time.Second
	rateMessages = 200
)

type Hub struct {
	mu     sync.Mutex
	topics map[string]map[*conn]struct{}
}

func NewHub() *Hub { return &Hub{topics: map[string]map[*conn]struct{}{}} }

type conn struct {
	ws     *websocket.Conn
	scope  string
	send   chan []byte
	topics map[string]struct{}
}

type message struct {
	Type   string   `json:"type"`
	Topics []string `json:"topics,omitempty"`
	Topic  string   `json:"topic,omitempty"`
	Data   *string  `json:"data,omitempty"`
}

func key(scope, topic string) string { return scope + "\x00" + topic }

// Topics is how many topics have subscribers (tests, logs).
func (h *Hub) Topics() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.topics)
}

// Serve runs one accepted connection until it closes.
func (h *Hub) Serve(ctx context.Context, ws *websocket.Conn, scope string) {
	ws.SetReadLimit(MaxMessage)
	c := &conn{ws: ws, scope: scope, send: make(chan []byte, 64), topics: map[string]struct{}{}}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	defer h.drop(c)
	go func() {
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				return
			case m := <-c.send:
				wctx, done := context.WithTimeout(ctx, 10*time.Second)
				err := ws.Write(wctx, websocket.MessageText, m)
				done()
				if err != nil {
					return
				}
			}
		}
	}()
	window, count := time.Now(), 0
	for {
		typ, data, err := ws.Read(ctx)
		if err != nil {
			_ = ws.Close(websocket.StatusNormalClosure, "")
			return
		}
		if typ != websocket.MessageText {
			continue
		}
		if time.Since(window) > rateWindow {
			window, count = time.Now(), 0
		}
		if count++; count > rateMessages {
			_ = ws.Close(websocket.StatusPolicyViolation, "too many messages")
			return
		}
		var m message
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		switch m.Type {
		case "subscribe":
			h.subscribe(c, m.Topics)
		case "unsubscribe":
			h.unsubscribe(c, m.Topics)
		case "publish":
			if m.Topic != "" && m.Data != nil {
				out, _ := json.Marshal(message{Type: "publish", Topic: m.Topic, Data: m.Data})
				h.publish(c, m.Topic, out)
			}
		case "ping":
			c.offer([]byte(`{"type":"pong"}`))
		}
	}
}

func (c *conn) offer(m []byte) {
	select {
	case c.send <- m:
	default: // a slow reader drops messages rather than stalling everyone
	}
}

func (h *Hub) subscribe(c *conn, topics []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, t := range topics {
		if t == "" || len(t) > 128 || len(c.topics) >= MaxTopics {
			continue
		}
		if _, ok := c.topics[t]; ok {
			continue
		}
		c.topics[t] = struct{}{}
		k := key(c.scope, t)
		if h.topics[k] == nil {
			h.topics[k] = map[*conn]struct{}{}
		}
		h.topics[k][c] = struct{}{}
	}
}

func (h *Hub) unsubscribe(c *conn, topics []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, t := range topics {
		h.leave(c, t)
	}
}

func (h *Hub) leave(c *conn, t string) {
	delete(c.topics, t)
	k := key(c.scope, t)
	if subs := h.topics[k]; subs != nil {
		delete(subs, c)
		if len(subs) == 0 {
			delete(h.topics, k)
		}
	}
}

func (h *Hub) drop(c *conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for t := range c.topics {
		h.leave(c, t)
	}
}

func (h *Hub) publish(from *conn, topic string, m []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.topics[key(from.scope, topic)] {
		if c != from {
			c.offer(m)
		}
	}
}
