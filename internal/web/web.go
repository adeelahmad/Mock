// Package web holds the built app, embedded into the binary. `make binary` copies Vite's dist/
// here before `go build`; without it the binary serves the API only (or MOCK_STATIC).
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// App is the embedded build, or nil when the binary was built without one.
func App() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return nil
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil
	}
	return sub
}
