//go:build windows

package main

import (
	"os"
	"time"

	"golang.org/x/term"
)

// startResizeWatcher polls the local terminal size on a timer, since
// Windows has no SIGWINCH equivalent that is reliable for console resize
// events. 500ms is a compromise between responsiveness and CPU cost.
func startResizeWatcher(p *cliTerminalProxy) func() {
	stop := make(chan struct{})
	go func() {
		var lastC, lastR int
		t := time.NewTicker(500 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				c, r, err := term.GetSize(int(os.Stdout.Fd()))
				if err != nil || c <= 0 || r <= 0 {
					continue
				}
				if c == lastC && r == lastR {
					continue
				}
				lastC, lastR = c, r
				_ = p.sendResize(uint16(c), uint16(r))
			}
		}
	}()
	return func() { close(stop) }
}
