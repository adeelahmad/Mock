// Mock — the whole app in one binary: the built web app (embedded), the sign-in and library sync
// server, and the Google Meet bridge.
//
//	mock [serve]   the app + API on :8787 (the Meet bridge too, with --meet)
//	mock token     print the setup token the first-run sign-in wizard asks for
//	mock bridge    only the Meet bridge, on 127.0.0.1:8788 (for an app hosted elsewhere)
//	mock version
//
// Environment (flags win):
//
//	PORT, HOST          listen address (8787, every interface)
//	MOCK_DB             SQLite file (data/mock.db)
//	DATABASE_URL        postgres://… — use Postgres instead of SQLite
//	MOCK_STATIC         serve the app from this directory instead of the embedded build ("-" = API only)
//	AUTH_SECRET         session secret (generated once and kept in the database if unset)
//	AUTH_URL            the public URL, when a proxy hides it (https://mock.example.com)
//	MOCK_SETUP_TOKEN    the first-run wizard's token (generated once and kept if unset)
//	MOCK_MEET=1         run the Meet bridge too: on 127.0.0.1:8788 (MOCK_BRIDGE_PORT) and on the main port
//	                    (WebSocket upgrades, for the app this server serves)
//	MOCK_BRIDGE_CODE    a fixed pairing code; MOCK_BRIDGE_ORIGINS extra app origins (comma-separated)
//	MOCK_BRIDGE_CHROMIUM  the Chrome/Chromium the Meet bot runs (else found on PATH)
//	MOCK_SIGNAL         the passphrase-sync relay at /signal: auth (signed-in users, default), open, off
//	MOCK_SIGNAL_ORIGINS app origins that may borrow the relay after signing in here (GitHub Pages)
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/adeelahmad/mock/internal/auth"
	"github.com/adeelahmad/mock/internal/meet"
	"github.com/adeelahmad/mock/internal/server"
	"github.com/adeelahmad/mock/internal/store"
	"github.com/adeelahmad/mock/internal/web"
)

// version is set at build time (-ldflags "-X main.version=…").
var version = "dev"

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	log.SetFlags(0)
	cmd := "serve"
	args := os.Args[1:]
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd, args = args[0], args[1:]
	}
	var err error
	switch cmd {
	case "serve":
		err = serve(args)
	case "token":
		err = token()
	case "bridge", "meet-bridge":
		err = bridge(args)
	case "version":
		fmt.Println(version)
	case "help", "-h", "--help":
		fmt.Print(usage)
	default:
		err = fmt.Errorf("unknown command %q\n\n%s", cmd, usage)
	}
	if err != nil {
		log.Fatal(err)
	}
}

const usage = `Mock — rehearse an interview loop with a live interviewer and a coach.

  mock [serve] [--port 8787] [--host 0.0.0.0] [--meet [--bridge-port 8788] [--headed]]
                 the app, sign-in and library sync (and the Meet bridge with --meet)
  mock token     print the setup token the sign-in wizard asks for
  mock bridge [--port 8788] [--headed] [--profile DIR]
                 only the Meet bridge, on 127.0.0.1, for an app hosted elsewhere
  mock version

Settings come from the environment too: PORT, HOST, MOCK_DB, DATABASE_URL, AUTH_URL,
AUTH_SECRET, MOCK_SETUP_TOKEN, MOCK_STATIC, MOCK_MEET, MOCK_BRIDGE_PORT, MOCK_BRIDGE_CODE,
MOCK_BRIDGE_ORIGINS, MOCK_BRIDGE_CHROMIUM, MOCK_SIGNAL, MOCK_SIGNAL_ORIGINS.
`

func openStore() (*store.Store, error) {
	return store.Open(os.Getenv("DATABASE_URL"), env("MOCK_DB", "data/mock.db"))
}

func setupToken(ctx context.Context, st *store.Store) (string, error) {
	if t := os.Getenv("MOCK_SETUP_TOKEN"); t != "" {
		return t, nil
	}
	var kept string
	if ok, err := st.GetConfig(ctx, "setup.token", &kept); err != nil {
		return "", err
	} else if ok && kept != "" {
		return kept, nil
	}
	t := auth.RandomToken(18)
	return t, st.SetConfig(ctx, "setup.token", t)
}

func token() error {
	st, err := openStore()
	if err != nil {
		return err
	}
	defer st.Close()
	t, err := setupToken(context.Background(), st)
	if err != nil {
		return err
	}
	fmt.Println(t)
	return nil
}

func truthy(s string) bool {
	b, _ := strconv.ParseBool(s)
	return b
}

type bridgeFlags struct {
	headed  *bool
	profile *string
	anyURL  *bool
	fakeBot *bool
}

func addBridgeFlags(fs *flag.FlagSet) bridgeFlags {
	return bridgeFlags{
		headed:  fs.Bool("headed", false, "show the Meet bot's browser window"),
		profile: fs.String("profile", "", "browser profile directory for the Meet bot (a signed-in Google account)"),
		anyURL:  fs.Bool("any-url", false, "allow any http(s) meeting URL (testing)"),
		fakeBot: fs.Bool("fake-bot", false, "a bot that pretends to join (testing)"),
	}
}

func newBridge(f bridgeFlags, sameOrigin bool) *meet.Bridge {
	origins := meet.DefaultOrigins
	if o := os.Getenv("MOCK_BRIDGE_ORIGINS"); o != "" {
		origins = nil
		for _, s := range strings.Split(o, ",") {
			if s = strings.TrimSpace(s); s != "" {
				origins = append(origins, s)
			}
		}
	}
	newBot := meet.NewChromeBot(meet.ChromeOptions{Headed: *f.headed, ProfileDir: *f.profile})
	if *f.fakeBot {
		newBot = meet.NewFakeBot
	}
	return &meet.Bridge{
		Token:      env("MOCK_BRIDGE_CODE", meet.PairingCode()),
		Origins:    origins,
		SameOrigin: sameOrigin,
		AnyURL:     *f.anyURL,
		NewBot:     newBot,
		Log:        func(l string) { log.Print(time.Now().Format("15:04:05") + "  " + l) },
	}
}

func listen(host, port string) (net.Listener, string, error) {
	ln, err := net.Listen("tcp", net.JoinHostPort(host, port))
	if err != nil {
		return nil, "", err
	}
	shown := host
	if host == "0.0.0.0" || host == "" || host == "::" {
		shown = "localhost"
	}
	return ln, net.JoinHostPort(shown, strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)), nil
}

func run(ln net.Listener, h http.Handler, onStop func()) error {
	srv := &http.Server{Handler: h, ReadHeaderTimeout: 15 * time.Second}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		if onStop != nil {
			onStop()
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func serve(args []string) error {
	fl := flag.NewFlagSet("serve", flag.ExitOnError)
	port := fl.String("port", env("PORT", "8787"), "listen port")
	host := fl.String("host", env("HOST", ""), "listen address (\"\" = every interface)")
	withMeet := fl.Bool("meet", truthy(os.Getenv("MOCK_MEET")), "run the Meet bridge too")
	bridgePort := fl.String("bridge-port", env("MOCK_BRIDGE_PORT", "8788"), "the Meet bridge's own port on 127.0.0.1 (\"\" = only the main port)")
	bf := addBridgeFlags(fl)
	_ = fl.Parse(args)

	ctx := context.Background()
	st, err := openStore()
	if err != nil {
		return err
	}
	defer st.Close()
	tok, err := setupToken(ctx, st)
	if err != nil {
		return err
	}
	secret, err := auth.Secret(ctx, st, os.Getenv("AUTH_SECRET"))
	if err != nil {
		return err
	}
	a := auth.New(st, secret)
	a.PublicURL = os.Getenv("AUTH_URL")
	if err := a.Load(ctx); err != nil {
		return err
	}

	var static fs.FS
	served := "the embedded app"
	switch dir := os.Getenv("MOCK_STATIC"); dir {
	case "":
		static = web.App()
		if static == nil {
			served = "no app (built without one: make binary)"
		}
	case "-":
		served = "the API only"
	default:
		static, served = os.DirFS(dir), dir
	}

	var br *meet.Bridge
	o := server.Options{Store: st, Auth: a, SetupToken: tok, Static: static, Version: version, Signal: os.Getenv("MOCK_SIGNAL")}
	if v := os.Getenv("MOCK_SIGNAL_ORIGINS"); v != "" {
		o.SignalOrigins = strings.Split(v, ",")
	}
	if *withMeet {
		br = newBridge(bf, true)
		o.Bridge = br
	}
	ln, addr, err := listen(*host, *port)
	if err != nil {
		return err
	}
	log.Printf("Mock server on http://%s · %s · serving %s", addr, st.Kind, served)
	if len(auth.ProviderList(a.Setup())) == 0 {
		log.Printf("Sign-in is not set up yet. Open the app; the setup wizard asks for this token:\n\n    %s\n", tok)
	}
	if br != nil {
		where := "ws://" + addr
		if *bridgePort != "" {
			bln, baddr, err := listen("127.0.0.1", *bridgePort)
			if err != nil {
				return fmt.Errorf("Meet bridge: %w", err)
			}
			go func() { _ = http.Serve(bln, br) }()
			where = "ws://" + baddr + " and " + where
		}
		log.Printf("Meet bridge on %s · pairing code: %s", where, br.Token)
	}
	return run(ln, server.New(o), func() {
		if br != nil {
			br.Close()
		}
	})
}

func bridge(args []string) error {
	fl := flag.NewFlagSet("bridge", flag.ExitOnError)
	port := fl.String("port", env("MOCK_BRIDGE_PORT", "8788"), "listen port")
	host := fl.String("host", "127.0.0.1", "listen address")
	bf := addBridgeFlags(fl)
	_ = fl.Parse(args)
	br := newBridge(bf, false)
	ln, addr, err := listen(*host, *port)
	if err != nil {
		return err
	}
	fmt.Printf("Mock Meet bridge on ws://%s\nPairing code: %s\nIn Mock: Practice → Interview in Google Meet. Ctrl-C to stop.\n", addr, br.Token)
	return run(ln, br, br.Close)
}
