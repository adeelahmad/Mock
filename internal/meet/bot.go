package meet

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/browser"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/input"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/cdproto/target"
	"github.com/chromedp/chromedp"
)

//go:embed inpage.js
var inpageJS string

//go:embed page.js
var pageJS string

// ChromeOptions say which browser the bot runs and how.
type ChromeOptions struct {
	// ExecPath is a Chrome/Chromium binary; "" finds one (FindChrome).
	ExecPath string
	Headed   bool
	// ProfileDir is a profile directory: a bot signed in to a Google account joins without knocking in Workspace domains.
	ProfileDir  string
	JoinTimeout time.Duration
}

// FindChrome is MOCK_BRIDGE_CHROMIUM, else the first Chrome or Chromium on PATH or in the usual places.
func FindChrome() string {
	if p := os.Getenv("MOCK_BRIDGE_CHROMIUM"); p != "" {
		return p
	}
	for _, n := range []string{"chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"} {
		if p, err := exec.LookPath(n); err == nil {
			return p
		}
	}
	for _, p := range []string{
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		"/opt/pw-browsers/chromium",
		"/snap/bin/chromium",
	} {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// ChromeBot is the bot: a Chromium that opens the meeting, joins as "Mock · Interviewer" with the
// in-page bridge installed, reports where it is, and carries audio both ways.
type ChromeBot struct {
	r BotRequest
	o ChromeOptions

	mu      sync.Mutex
	status  Status
	stopped bool
	ctx     context.Context
	cancel  context.CancelFunc
	jobs    chan func(context.Context)
}

// NewChromeBot returns a bot factory for the bridge.
func NewChromeBot(o ChromeOptions) func(BotRequest) Bot {
	return func(r BotRequest) Bot { return &ChromeBot{r: r, o: o, status: Idle, jobs: make(chan func(context.Context), 256)} }
}

func (b *ChromeBot) set(s Status, message string) {
	b.mu.Lock()
	same := s == b.status && message == ""
	b.status = s
	b.mu.Unlock()
	if !same {
		b.r.OnStatus(s, message)
	}
}

func (b *ChromeBot) get() (Status, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.status, b.stopped
}

func (b *ChromeBot) Start(parent context.Context) error {
	b.set(Launching, "")
	exe := b.o.ExecPath
	if exe == "" {
		exe = FindChrome()
	}
	if exe == "" {
		return errors.New("No Chrome or Chromium found · install one or set MOCK_BRIDGE_CHROMIUM")
	}
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(exe),
		chromedp.Flag("enable-automation", false),
		chromedp.Flag("use-fake-ui-for-media-stream", true),     // grant mic/camera without a prompt
		chromedp.Flag("use-fake-device-for-media-stream", true), // devices exist; the in-page bridge replaces their streams
		chromedp.Flag("autoplay-policy", "no-user-gesture-required"),
		chromedp.Flag("disable-blink-features", "AutomationControlled"),
		chromedp.Flag("no-sandbox", true),
		chromedp.WindowSize(1280, 800),
	)
	if b.o.Headed {
		opts = append(opts, chromedp.Flag("headless", false), chromedp.Flag("hide-scrollbars", false), chromedp.Flag("mute-audio", false))
	}
	if b.o.ProfileDir != "" {
		opts = append(opts, chromedp.UserDataDir(b.o.ProfileDir))
	}
	actx, acancel := context.WithCancel(context.Background())
	actx, _ = chromedp.NewExecAllocator(actx, opts...)
	ctx, _ := chromedp.NewContext(actx)
	b.mu.Lock()
	if b.stopped {
		b.mu.Unlock()
		acancel()
		return nil
	}
	b.ctx, b.cancel = ctx, acancel
	b.mu.Unlock()
	go b.worker(ctx)

	if err := chromedp.Run(ctx); err != nil {
		return fmt.Errorf("Could not start %s: %w", exe, err)
	}
	// Headless Chromium says so in its user agent, and Meet turns it away.
	var ua string
	if err := chromedp.Run(ctx, chromedp.ActionFunc(func(c context.Context) error {
		_, _, _, u, _, err := browser.GetVersion().Do(c)
		ua = strings.Replace(u, "HeadlessChrome", "Chrome", 1)
		return err
	})); err != nil {
		return err
	}
	chromedp.ListenTarget(ctx, func(ev any) {
		switch e := ev.(type) {
		case *runtime.EventBindingCalled:
			if e.Name != "__mockBridgeSend" {
				return
			}
			var m struct {
				Type string `json:"type"`
				Data string `json:"data"`
			}
			if json.Unmarshal([]byte(e.Payload), &m) == nil && m.Type == "pcm" && m.Data != "" {
				if s, _ := b.get(); s == InCall {
					b.r.OnPCM(m.Data)
				}
			}
		case *target.EventDetachedFromTarget, *target.EventTargetCrashed:
			if s, stopped := b.get(); !stopped && s != Left {
				b.set(Left, "The bot’s browser closed")
			}
		}
	})
	u, err := url.Parse(b.r.URL)
	if err != nil {
		return err
	}
	origin := u.Scheme + "://" + u.Host
	b.set(Joining, "")
	navCtx, navCancel := context.WithTimeout(ctx, 30*time.Second)
	defer navCancel()
	err = chromedp.Run(navCtx,
		emulation.SetUserAgentOverride(ua),
		browser.GrantPermissions([]browser.PermissionType{browser.PermissionTypeAudioCapture, browser.PermissionTypeVideoCapture}).WithOrigin(origin),
		runtime.AddBinding("__mockBridgeSend"),
		chromedp.ActionFunc(func(c context.Context) error {
			_, err := page.AddScriptToEvaluateOnNewDocument(inpageJS).Do(c)
			return err
		}),
		chromedp.ActionFunc(func(c context.Context) error {
			_, _, errText, _, err := page.Navigate(b.r.URL).Do(c)
			if err == nil && errText != "" {
				err = errors.New(errText)
			}
			return err
		}),
	)
	if err != nil {
		if _, stopped := b.get(); stopped {
			return nil
		}
		return fmt.Errorf("Could not open %s: %w", b.r.URL, err)
	}
	go b.join(ctx)
	return nil
}

type pageResult struct {
	State   string  `json:"state"`
	Text    string  `json:"text"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Enabled bool    `json:"enabled"`
	Value   string  `json:"value"`
}

// look runs page.js; ok=false when the control is not there.
func look(ctx context.Context, action string) (pageResult, bool) {
	var res *pageResult
	c, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := chromedp.Run(c, chromedp.Evaluate("("+pageJS+")("+fmt.Sprintf("%q", action)+")", &res)); err != nil || res == nil {
		return pageResult{State: "loading"}, false
	}
	return *res, true
}

func click(ctx context.Context, p pageResult) error {
	c, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return chromedp.Run(c, chromedp.MouseClickXY(p.X, p.Y))
}

// joinStep is one step on the join screen: dismiss a dialog, type the name, press join. True when it pressed join.
func (b *ChromeBot) joinStep(ctx context.Context) bool {
	if d, ok := look(ctx, "dismiss"); ok {
		_ = click(ctx, d)
	}
	if n, ok := look(ctx, "name"); ok && n.Value == "" {
		if click(ctx, n) == nil {
			c, cancel := context.WithTimeout(ctx, 2*time.Second)
			_ = chromedp.Run(c, input.InsertText(b.r.Name))
			cancel()
		}
	}
	if j, ok := look(ctx, "join"); ok && j.Enabled {
		return click(ctx, j) == nil
	}
	return false
}

func (b *ChromeBot) join(ctx context.Context) {
	timeout := b.o.JoinTimeout
	if timeout == 0 {
		timeout = 10 * time.Minute
	}
	deadline := time.Now().Add(timeout)
	pressed := false
	for time.Now().Before(deadline) {
		if _, stopped := b.get(); stopped || ctx.Err() != nil {
			return
		}
		st, _ := look(ctx, "state")
		switch st.State {
		case "in_call":
			b.set(InCall, "")
			b.monitor(ctx)
			return
		case "denied":
			b.set(Failed, st.Text)
			return
		case "waiting":
			b.set(Waiting, "")
		case "join_screen":
			// Back on the join screen after pressing: the request lapsed or was declined; try again.
			was := pressed
			pressed = b.joinStep(ctx)
			if pressed && !was {
				b.set(Joining, "Asked to join")
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(500 * time.Millisecond):
		}
	}
	if _, stopped := b.get(); !stopped {
		b.set(Failed, "Nobody let Mock in")
	}
}

// monitor notices being removed or the call ending.
func (b *ChromeBot) monitor(ctx context.Context) {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		s, stopped := b.get()
		if stopped || s != InCall {
			return
		}
		st, ok := look(ctx, "state")
		if !ok {
			continue
		}
		if st.State == "denied" {
			b.set(Left, st.Text)
		} else if st.State != "in_call" && st.State != "loading" {
			b.set(Left, "Mock is no longer in the call")
		}
	}
}

// worker runs page calls in order, never blocking the caller.
func (b *ChromeBot) worker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case job := <-b.jobs:
			job(ctx)
		}
	}
}

func (b *ChromeBot) run(js string) {
	if _, stopped := b.get(); stopped {
		return
	}
	select {
	case b.jobs <- func(ctx context.Context) {
		c, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		_ = chromedp.Run(c, chromedp.Evaluate(js, nil))
	}:
	default: // the page is far behind; drop rather than block the socket
	}
}

func jsArg(v any) string { b, _ := json.Marshal(v); return string(b) }

func (b *ChromeBot) Play(data string, rate float64) {
	b.run("window.__mockBridge && window.__mockBridge.play(" + jsArg(data) + "," + jsArg(rate) + ")")
}
func (b *ChromeBot) Flush() { b.run("window.__mockBridge && window.__mockBridge.flush()") }
func (b *ChromeBot) Tile(t Tile) {
	b.run("window.__mockBridge && window.__mockBridge.tile(" + jsArg(t) + ")")
}

func (b *ChromeBot) Leave() {
	b.mu.Lock()
	if b.stopped {
		b.mu.Unlock()
		return
	}
	b.stopped = true
	ctx, cancel, status := b.ctx, b.cancel, b.status
	b.mu.Unlock()
	if ctx != nil && status == InCall {
		if l, ok := look(ctx, "leave"); ok {
			_ = click(ctx, l)
		}
	}
	if ctx != nil {
		c, cc := context.WithTimeout(ctx, 3*time.Second)
		_ = chromedp.Cancel(c)
		cc()
	}
	if cancel != nil {
		cancel()
	}
	b.set(Left, "")
}
