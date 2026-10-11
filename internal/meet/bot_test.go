package meet

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"
)

// tone is the signal power at one frequency (Goertzel), normalised by the frame's energy.
func tone(pcm []int16, rate, hz float64) float64 {
	k := 2 * math.Cos(2*math.Pi*hz/rate)
	var s1, s2, energy float64
	for _, v := range pcm {
		x := float64(v) / 32768
		s := x + k*s1 - s2
		s2, s1 = s1, s
		energy += x * x
	}
	if energy == 0 {
		return 0
	}
	return (s1*s1 + s2*s2 - k*s1*s2) / (energy * float64(len(pcm)))
}

func decode(b64 string) []int16 {
	b, _ := base64.StdEncoding.DecodeString(b64)
	out := make([]int16, len(b)/2)
	for i := range out {
		out[i] = int16(binary.LittleEndian.Uint16(b[i*2:]))
	}
	return out
}

func sine(hz, rate float64, ms int) string {
	n := int(rate * float64(ms) / 1000)
	b := make([]byte, n*2)
	for i := 0; i < n; i++ {
		binary.LittleEndian.PutUint16(b[i*2:], uint16(int16(math.Round(math.Sin(2*math.Pi*hz*float64(i)/rate)*20000))))
	}
	return base64.StdEncoding.EncodeToString(b)
}

// The real bot against a fake Meet page: it joins (name, knock, let in), hears the participant
// through the RTCPeerConnection hook, and speaks through its microphone.
func TestChromeBotJoinsHearsAndSpeaks(t *testing.T) {
	exe := os.Getenv("PW_CHROMIUM")
	if exe == "" {
		exe = FindChrome()
	}
	if exe == "" || testing.Short() {
		t.Skip("no Chrome or Chromium")
	}
	page, err := os.ReadFile("../../tests/fixtures/fake-meet.html")
	if err != nil {
		t.Fatal(err)
	}
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write(page)
	}))
	defer site.Close()

	var mu sync.Mutex
	var statuses []Status
	var frames [][]int16
	status := func() Status { mu.Lock(); defer mu.Unlock(); return statuses[len(statuses)-1] }
	heard := func(from int, hz, min float64) bool {
		mu.Lock()
		defer mu.Unlock()
		for _, f := range frames[min0(from, len(frames)):] {
			if tone(f, 16000, hz) > min {
				return true
			}
		}
		return false
	}
	bot := NewChromeBot(ChromeOptions{ExecPath: exe, JoinTimeout: 20 * time.Second})(BotRequest{
		URL: site.URL + "/meet", Name: DefaultBotName,
		OnStatus: func(s Status, _ string) {
			mu.Lock()
			defer mu.Unlock()
			if len(statuses) == 0 || statuses[len(statuses)-1] != s {
				statuses = append(statuses, s)
			}
		},
		OnPCM: func(b string) { mu.Lock(); frames = append(frames, decode(b)); mu.Unlock() },
	})
	defer bot.Leave()
	if err := bot.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	poll := func(what string, d time.Duration, p func() bool) {
		t.Helper()
		for end := time.Now().Add(d); time.Now().Before(end); time.Sleep(100 * time.Millisecond) {
			if p() {
				return
			}
		}
		mu.Lock()
		defer mu.Unlock()
		t.Fatalf("%s: statuses %v, %d frames", what, statuses, len(frames))
	}
	poll("in the call", 30*time.Second, func() bool { return status() == InCall })

	// The participant's 440 Hz tone arrives as 16 kHz PCM.
	poll("hears the call", 15*time.Second, func() bool { return heard(0, 440, 0.2) })

	// Silence on Mock's microphone until it speaks (the in-page bridge replaced the fake device).
	time.Sleep(1500 * time.Millisecond)
	if heard(0, 1000, 0.05) {
		t.Fatal("Mock's microphone was not silent")
	}
	// Mock speaks: a 1 kHz tone through its microphone, looped back by the fake page.
	mu.Lock()
	before := len(frames)
	mu.Unlock()
	for i := 0; i < 20; i++ {
		bot.Play(sine(1000, 24000, 100), 24000)
	}
	poll("speaks into the call", 15*time.Second, func() bool { return heard(before, 1000, 0.05) })

	bot.Tile(Tile{Name: "Dana Whitfield", Mono: "DW", Role: "Bar Raiser", Phase: "Asking", Question: "Tell me about a time you disagreed with your manager.", LP: "Have Backbone"})
	bot.Leave()
	poll("left", 10*time.Second, func() bool { return status() == Left })
	mu.Lock()
	defer mu.Unlock()
	want := []Status{Launching, Joining}
	for i, s := range want {
		if statuses[i] != s {
			t.Fatalf("statuses %v", statuses)
		}
	}
}

func min0(a, b int) int {
	if a < b {
		return a
	}
	return b
}
