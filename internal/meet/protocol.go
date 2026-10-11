// Package meet is the Meet bridge: one WebSocket the app pairs with, and a headless Chromium bot
// (driven over the DevTools protocol) that joins the Google Meet call and carries audio both ways.
// The app keeps the session (Gemini Live, the controller, the library); see docs/meet.md and the
// wire protocol in src/meet/protocol.ts, which this file mirrors.
package meet

import (
	"encoding/json"
	"regexp"
	"strings"
)

const (
	Version        = 1
	DefaultBotName = "Mock · Interviewer"
	maxAudio       = 2_000_000
)

// Status is where the bot is.
type Status string

const (
	Idle      Status = "idle"
	Launching Status = "launching"
	Joining   Status = "joining"
	Waiting   Status = "waiting"
	InCall    Status = "in_call"
	Left      Status = "left"
	Failed    Status = "error"
)

// Tile is what the bot's camera shows.
type Tile struct {
	Name     string `json:"name"`
	Mono     string `json:"mono"`
	Role     string `json:"role"`
	Phase    string `json:"phase"`
	Question string `json:"question"`
	LP       string `json:"lp"`
}

// ClientMsg is a message from the app, validated.
type ClientMsg struct {
	Type       string
	Token      string
	Version    float64
	MeetingURL string
	BotName    string
	Data       string
	Rate       float64
	Tile       Tile
}

// BridgeMsg is a message to the app.
type BridgeMsg struct {
	Type       string `json:"type"`
	Version    int    `json:"version,omitempty"`
	Status     Status `json:"status,omitempty"`
	Message    string `json:"message,omitempty"`
	MeetingURL string `json:"meetingUrl,omitempty"`
	Data       string `json:"data,omitempty"`
}

func strOK(m map[string]any, k string, max int) (string, bool) {
	s, ok := m[k].(string)
	return s, ok && len([]rune(s)) <= max
}

// ParseClientMsg validates a message from the app (ok=false when malformed).
func ParseClientMsg(raw []byte) (ClientMsg, bool) {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil || m == nil {
		return ClientMsg{}, false
	}
	t, _ := m["type"].(string)
	switch t {
	case "hello":
		tok, ok := strOK(m, "token", 200)
		v, vok := m["version"].(float64)
		return ClientMsg{Type: t, Token: tok, Version: v}, ok && vok
	case "join":
		u, ok1 := strOK(m, "meetingUrl", 500)
		n, ok2 := strOK(m, "botName", 80)
		return ClientMsg{Type: t, MeetingURL: u, BotName: n}, ok1 && ok2
	case "play":
		d, ok := strOK(m, "data", maxAudio)
		r, rok := m["rate"].(float64)
		return ClientMsg{Type: t, Data: d, Rate: r}, ok && rok && r >= 8000 && r <= 48000
	case "flush", "leave":
		return ClientMsg{Type: t}, true
	case "tile":
		tm, _ := m["tile"].(map[string]any)
		if tm == nil {
			return ClientMsg{}, false
		}
		var tile Tile
		fields := []struct {
			k string
			p *string
		}{{"name", &tile.Name}, {"mono", &tile.Mono}, {"role", &tile.Role}, {"phase", &tile.Phase}, {"question", &tile.Question}, {"lp", &tile.LP}}
		for _, f := range fields {
			s, ok := strOK(tm, f.k, 1000)
			if !ok {
				return ClientMsg{}, false
			}
			*f.p = s
		}
		return ClientMsg{Type: t, Tile: tile}, true
	}
	return ClientMsg{}, false
}

var meetLink = regexp.MustCompile(`(?i)^(?:(?:https?://)?meet\.google\.com/)?([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#].*)?$`)

// ParseMeetLink is a Google Meet link in canonical form, from a URL or a bare code ("" if neither).
func ParseMeetLink(input string) string {
	m := meetLink.FindStringSubmatch(strings.TrimSpace(input))
	if m == nil {
		return ""
	}
	return "https://meet.google.com/" + strings.ToLower(m[1])
}
