//go:build !windows

package main

import (
	"os"
	"os/signal"
	"syscall"

	"golang.org/x/term"
)

// startResizeWatcher installs a SIGWINCH handler that pushes the new local
// terminal size to the daemon every time the user resizes their window.
// Returns a stop function that uninstalls the handler and exits the
// goroutine. On platforms without SIGWINCH (Windows) the windows-tagged
// implementation polls term.GetSize on a timer instead.
func startResizeWatcher(p *cliTerminalProxy) func() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGWINCH)
	stop := make(chan struct{})

	go func() {
		for {
			select {
			case <-ch:
				if c, r, err := term.GetSize(int(os.Stdout.Fd())); err == nil && c > 0 && r > 0 {
					_ = p.sendResize(uint16(c), uint16(r))
				}
			case <-stop:
				return
			}
		}
	}()

	return func() {
		signal.Stop(ch)
		close(stop)
	}
}
