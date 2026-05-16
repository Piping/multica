package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/multica-ai/multica/server/pkg/protocol"
)

var issueTerminalCmd = &cobra.Command{
	Use:   "terminal <issue-id>",
	Short: "Attach to the issue's most recent agent task PTY",
	Long: "Open an interactive shell inside the workdir of the issue's most recent agent task. " +
		"Reuses the daemon-side PTY manager added in MUL-2295 — the daemon spawns a bash login " +
		"shell with CLAUDE_SESSION_ID + MULTICA_{WORKSPACE,ISSUE,TASK,USER}_ID injected so you " +
		"can immediately `claude --resume $CLAUDE_SESSION_ID`.\n\n" +
		"Detach without closing your shell: type `<enter>~.` (escape sequence). The daemon-side " +
		"session is currently torn down on disconnect — see RFC follow-up for `--attach`.",
	Args: exactArgs(1),
	RunE: runIssueTerminal,
}

const (
	terminalDefaultCols       = 80
	terminalDefaultRows       = 24
	terminalAuthAckTimeout    = 10 * time.Second
	terminalOpenAckTimeout    = 15 * time.Second
	terminalServerWriteWait   = 10 * time.Second
	terminalServerReadLimit   = 1 << 20 // 1 MiB per frame; matches realistic xterm bursts
	terminalDetachExitMessage = "[multica] detached — daemon session was torn down"
)

func init() {
	issueCmd.AddCommand(issueTerminalCmd)
	issueTerminalCmd.Flags().Uint16("cols", 0, "Initial terminal columns (defaults to detected size, or 80 if stdout is not a TTY)")
	issueTerminalCmd.Flags().Uint16("rows", 0, "Initial terminal rows (defaults to detected size, or 24 if stdout is not a TTY)")
	issueTerminalCmd.Flags().String("escape-char", "~", "Escape character for detach sequence (`<enter><esc>.` to detach). Empty disables escape detection.")
	issueTerminalCmd.Flags().Bool("no-raw", false, "Don't put the local TTY into raw mode (mostly for testing / piped input)")
}

func runIssueTerminal(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	if _, err := requireWorkspaceID(cmd); err != nil {
		return err
	}
	token := resolveToken(cmd)
	if token == "" {
		return fmt.Errorf("not authenticated: run 'multica login'")
	}

	resolveCtx, cancelResolve := context.WithTimeout(cmd.Context(), 15*time.Second)
	defer cancelResolve()
	issueRef, err := resolveIssueRef(resolveCtx, client, args[0])
	if err != nil {
		return fmt.Errorf("resolve issue: %w", err)
	}

	// Detect terminal size from stdout (the surface the user actually sees);
	// fall back to defaults if stdout is piped. Flag overrides win.
	cols, rows := detectInitialSize(cmd)

	pathAndQuery := buildTerminalPathAndQuery(issueRef.ID, client.WorkspaceID, cols, rows)

	// Use a long-lived context for the WS connection; cancellation is driven
	// by the proxy goroutines + signals rather than a timeout.
	conn, _, err := client.DialWebSocket(cmd.Context(), pathAndQuery)
	if err != nil {
		return fmt.Errorf("dial terminal websocket: %w", err)
	}

	proxy := newCLITerminalProxy(conn, os.Stdin, os.Stdout, os.Stderr, token, cmd)
	return proxy.run(cmd.Context(), cols, rows)
}

func detectInitialSize(cmd *cobra.Command) (uint16, uint16) {
	cols, _ := cmd.Flags().GetUint16("cols")
	rows, _ := cmd.Flags().GetUint16("rows")
	if cols > 0 && rows > 0 {
		return cols, rows
	}
	if c, r, err := term.GetSize(int(os.Stdout.Fd())); err == nil && c > 0 && r > 0 {
		if cols == 0 {
			cols = uint16(c)
		}
		if rows == 0 {
			rows = uint16(r)
		}
	}
	if cols == 0 {
		cols = terminalDefaultCols
	}
	if rows == 0 {
		rows = terminalDefaultRows
	}
	return cols, rows
}

func buildTerminalPathAndQuery(issueID, workspaceID string, cols, rows uint16) string {
	q := url.Values{}
	q.Set("workspace_id", workspaceID)
	q.Set("cols", strconv.FormatUint(uint64(cols), 10))
	q.Set("rows", strconv.FormatUint(uint64(rows), 10))
	return "/ws/issues/" + url.PathEscape(issueID) + "/terminal?" + q.Encode()
}

// cliTerminalProxy mirrors the server-side terminalProxy: one goroutine
// owns conn writes, one owns conn reads, plus a stdin reader and resize
// watcher. The struct is the only owner of the websocket.Conn; all writes
// go through writeFrame() to keep a single point that holds writeMu.
type cliTerminalProxy struct {
	conn   *websocket.Conn
	stdin  io.Reader
	stdout io.Writer
	stderr io.Writer
	token  string
	cmd    *cobra.Command

	writeMu sync.Mutex

	sessionMu sync.RWMutex
	sessionID string

	closeOnce sync.Once
	doneCh    chan struct{}

	// exit reporting from the read pump back to the orchestrator.
	exitCode atomic.Int32 // 0 = unset, see exitCodeUnset / >=1
	exitMsg  atomic.Pointer[string]

	escapeChar byte
	noRaw      bool
}

const exitCodeUnset int32 = -1

func newCLITerminalProxy(conn *websocket.Conn, stdin io.Reader, stdout, stderr io.Writer, token string, cmd *cobra.Command) *cliTerminalProxy {
	escape, _ := cmd.Flags().GetString("escape-char")
	noRaw, _ := cmd.Flags().GetBool("no-raw")
	var ec byte
	if len(escape) >= 1 {
		ec = escape[0]
	}
	p := &cliTerminalProxy{
		conn:       conn,
		stdin:      stdin,
		stdout:     stdout,
		stderr:     stderr,
		token:      token,
		cmd:        cmd,
		doneCh:     make(chan struct{}),
		escapeChar: ec,
		noRaw:      noRaw,
	}
	p.exitCode.Store(exitCodeUnset)
	conn.SetReadLimit(terminalServerReadLimit)
	return p
}

func (p *cliTerminalProxy) run(ctx context.Context, cols, rows uint16) error {
	defer p.conn.Close()

	if err := p.handshake(); err != nil {
		return err
	}

	// Push our local size right after open in case the server's hardcoded
	// initial 80x24 didn't match. (Phase 2 server stamps 80x24 on the
	// daemon-bound terminal.open frame regardless of query string; sending
	// resize immediately makes the PTY render correctly.)
	if err := p.sendResize(cols, rows); err != nil {
		// non-fatal — daemon will just keep the original size
		fmt.Fprintf(p.stderr, "[multica] warning: initial resize failed: %v\n", err)
	}

	rawTTY := !p.noRaw && term.IsTerminal(int(os.Stdin.Fd()))
	var restore func() error
	if rawTTY {
		oldState, err := term.MakeRaw(int(os.Stdin.Fd()))
		if err != nil {
			return fmt.Errorf("enter raw mode: %w", err)
		}
		fd := int(os.Stdin.Fd())
		restore = func() error { return term.Restore(fd, oldState) }
		defer restore()
	}

	stopResize := startResizeWatcher(p)
	defer stopResize()

	go p.readPump()
	go p.stdinPump(rawTTY)

	select {
	case <-p.doneCh:
	case <-ctx.Done():
		p.shutdown()
	}

	if restore != nil {
		_ = restore()
	}

	if msgPtr := p.exitMsg.Load(); msgPtr != nil && *msgPtr != "" {
		fmt.Fprintln(p.stderr, *msgPtr)
	}
	if code := p.exitCode.Load(); code > 0 {
		os.Exit(int(code))
	}
	return nil
}

// handshake performs first-frame auth and waits for terminal.opened.
func (p *cliTerminalProxy) handshake() error {
	authFrame, err := json.Marshal(struct {
		Type    string         `json:"type"`
		Payload map[string]any `json:"payload"`
	}{
		Type:    "auth",
		Payload: map[string]any{"token": p.token},
	})
	if err != nil {
		return fmt.Errorf("marshal auth frame: %w", err)
	}
	if err := p.writeRawFrame(authFrame); err != nil {
		return fmt.Errorf("send auth frame: %w", err)
	}

	deadline := time.Now().Add(terminalAuthAckTimeout)
	if err := p.conn.SetReadDeadline(deadline); err != nil {
		return fmt.Errorf("set auth read deadline: %w", err)
	}
	for {
		_, raw, err := p.conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("read auth response: %w", err)
		}
		var preview struct {
			Type  string `json:"type"`
			Error string `json:"error"`
		}
		if err := json.Unmarshal(raw, &preview); err == nil {
			if preview.Error != "" {
				return fmt.Errorf("auth rejected: %s", preview.Error)
			}
			if preview.Type == "auth_ack" {
				break
			}
		}
		// Tolerate stray frames during handshake (none expected in current
		// server implementation, but don't lock up if that changes).
	}

	// After auth_ack the server proxies a terminal.open to the daemon and
	// waits for terminal.opened or terminal.error. Block until we see one.
	openDeadline := time.Now().Add(terminalOpenAckTimeout)
	if err := p.conn.SetReadDeadline(openDeadline); err != nil {
		return fmt.Errorf("set open read deadline: %w", err)
	}
	for {
		_, raw, err := p.conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("waiting for terminal.opened: %w", err)
		}
		var env protocol.Message
		if err := json.Unmarshal(raw, &env); err != nil {
			continue
		}
		switch env.Type {
		case protocol.MessageTypeTerminalOpened:
			var op protocol.TerminalOpenedPayload
			if err := json.Unmarshal(env.Payload, &op); err != nil {
				return fmt.Errorf("decode terminal.opened: %w", err)
			}
			if op.SessionID == "" {
				return fmt.Errorf("daemon returned empty session_id in terminal.opened")
			}
			p.setSessionID(op.SessionID)
			workDir := op.WorkDir
			if workDir == "" {
				workDir = "(unknown)"
			}
			fmt.Fprintf(p.stderr, "[multica] attached to %s — escape: %s.\r\n", workDir, escapeHelpString(p.escapeChar))
			// Restore non-blocking reads for the pumps.
			if err := p.conn.SetReadDeadline(time.Time{}); err != nil {
				return fmt.Errorf("clear read deadline: %w", err)
			}
			return nil
		case protocol.MessageTypeTerminalError:
			var ep protocol.TerminalErrorPayload
			if err := json.Unmarshal(env.Payload, &ep); err != nil {
				return fmt.Errorf("daemon returned terminal.error (undecodable)")
			}
			return fmt.Errorf("daemon rejected terminal.open: %s (%s)", ep.Message, ep.Code)
		default:
			// keep waiting
		}
	}
}

func escapeHelpString(b byte) string {
	if b == 0 {
		return "(disabled)"
	}
	return "<enter>" + string(b) + "."
}

func (p *cliTerminalProxy) readPump() {
	defer p.shutdown()
	for {
		_, raw, err := p.conn.ReadMessage()
		if err != nil {
			if !isClosedConnError(err) {
				msg := fmt.Sprintf("[multica] websocket closed: %v", err)
				p.exitMsg.CompareAndSwap(nil, &msg)
			}
			return
		}
		var env protocol.Message
		if err := json.Unmarshal(raw, &env); err != nil {
			continue
		}
		switch env.Type {
		case protocol.MessageTypeTerminalData:
			var pl protocol.TerminalDataPayload
			if err := json.Unmarshal(env.Payload, &pl); err != nil {
				continue
			}
			data, err := base64.StdEncoding.DecodeString(pl.DataB64)
			if err != nil {
				continue
			}
			_, _ = p.stdout.Write(data)
		case protocol.MessageTypeTerminalExit:
			var pl protocol.TerminalExitPayload
			if err := json.Unmarshal(env.Payload, &pl); err != nil {
				continue
			}
			reason := pl.Reason
			if reason == "" {
				reason = "child exited"
			}
			msg := fmt.Sprintf("\r\n[multica] %s (exit code %d)", reason, pl.ExitCode)
			p.exitMsg.CompareAndSwap(nil, &msg)
			if pl.ExitCode > 0 {
				p.exitCode.Store(int32(pl.ExitCode))
			}
			return
		case protocol.MessageTypeTerminalError:
			var pl protocol.TerminalErrorPayload
			if err := json.Unmarshal(env.Payload, &pl); err != nil {
				continue
			}
			msg := fmt.Sprintf("\r\n[multica] error: %s (%s)", pl.Message, pl.Code)
			p.exitMsg.CompareAndSwap(nil, &msg)
			p.exitCode.Store(1)
			return
		case protocol.MessageTypeTerminalClose:
			return
		}
	}
}

// stdinPump reads stdin, runs it through the escape-sequence state machine,
// and forwards bytes as terminal.data frames. Detach (~.) closes the WS
// without sending the bytes.
func (p *cliTerminalProxy) stdinPump(rawTTY bool) {
	defer p.shutdown()

	buf := make([]byte, 4096)
	// Start in newline state so the very first character can trigger an
	// escape sequence; mirrors ssh's behavior.
	state := newlineState{atNewline: true}
	for {
		n, err := p.stdin.Read(buf)
		if n > 0 {
			toSend, detach := state.process(buf[:n], p.escapeChar)
			if len(toSend) > 0 {
				if err := p.sendData(toSend); err != nil {
					return
				}
			}
			if detach {
				msg := terminalDetachExitMessage
				p.exitMsg.CompareAndSwap(nil, &msg)
				_ = p.sendCloseBestEffort("client_detach")
				return
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				msg := fmt.Sprintf("[multica] stdin error: %v", err)
				p.exitMsg.CompareAndSwap(nil, &msg)
			}
			return
		}
	}
}

func (p *cliTerminalProxy) sendData(data []byte) error {
	sid := p.SessionID()
	if sid == "" {
		return errors.New("session_id not set")
	}
	frame, err := marshalCLITerminalFrame(protocol.MessageTypeTerminalData, protocol.TerminalDataPayload{
		SessionID: sid,
		DataB64:   base64.StdEncoding.EncodeToString(data),
	})
	if err != nil {
		return err
	}
	return p.writeRawFrame(frame)
}

func (p *cliTerminalProxy) sendResize(cols, rows uint16) error {
	sid := p.SessionID()
	if sid == "" {
		// Pre-handshake resize is sent later by run() once session is known.
		return nil
	}
	frame, err := marshalCLITerminalFrame(protocol.MessageTypeTerminalResize, protocol.TerminalResizePayload{
		SessionID: sid,
		Cols:      cols,
		Rows:      rows,
	})
	if err != nil {
		return err
	}
	return p.writeRawFrame(frame)
}

func (p *cliTerminalProxy) sendCloseBestEffort(reason string) error {
	sid := p.SessionID()
	if sid == "" {
		return nil
	}
	frame, err := marshalCLITerminalFrame(protocol.MessageTypeTerminalClose, protocol.TerminalClosePayload{
		SessionID: sid,
		Reason:    reason,
	})
	if err != nil {
		return err
	}
	return p.writeRawFrame(frame)
}

func (p *cliTerminalProxy) writeRawFrame(frame []byte) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if err := p.conn.SetWriteDeadline(time.Now().Add(terminalServerWriteWait)); err != nil {
		return err
	}
	return p.conn.WriteMessage(websocket.TextMessage, frame)
}

func (p *cliTerminalProxy) SessionID() string {
	p.sessionMu.RLock()
	defer p.sessionMu.RUnlock()
	return p.sessionID
}

func (p *cliTerminalProxy) setSessionID(sid string) {
	p.sessionMu.Lock()
	defer p.sessionMu.Unlock()
	p.sessionID = sid
}

func (p *cliTerminalProxy) shutdown() {
	p.closeOnce.Do(func() {
		close(p.doneCh)
		_ = p.conn.Close()
	})
}

func marshalCLITerminalFrame(msgType string, payload any) ([]byte, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(protocol.Message{Type: msgType, Payload: raw})
}

func isClosedConnError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.EOF) {
		return true
	}
	if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
		return true
	}
	return false
}

// --- escape sequence state machine -----------------------------------------
//
// Mirrors ssh(1)'s `~.` detach: after a newline, a single escape character
// followed by `.` detaches; `~~` emits a literal escape; `~?` prints help;
// any other byte aborts the escape and forwards both bytes.

type newlineState struct {
	atNewline bool
	gotEscape bool
}

// process consumes a chunk of stdin bytes. Returns the bytes that should
// actually be forwarded to the daemon and whether the user requested detach.
// The state machine mutates the receiver across calls so multi-byte chunks
// straddling escape boundaries (rare, but possible with paste) work.
func (s *newlineState) process(in []byte, escape byte) (out []byte, detach bool) {
	if escape == 0 {
		// Escape detection disabled — pass through.
		return in, false
	}
	out = make([]byte, 0, len(in))
	for _, b := range in {
		switch {
		case s.gotEscape:
			s.gotEscape = false
			switch b {
			case '.':
				return out, true
			case escape:
				out = append(out, escape)
				s.atNewline = false
			case '?':
				// Help is a local-only signal — not delivered to PTY.
				// Caller can detect by … actually keep it simple: just
				// emit a CR for visual feedback so the prompt redraws.
				out = append(out, '\r')
				s.atNewline = true
			default:
				// Not a recognized escape: forward ESC then this byte.
				out = append(out, escape, b)
				s.atNewline = b == '\r' || b == '\n'
			}
		case s.atNewline && b == escape:
			s.gotEscape = true
		default:
			out = append(out, b)
			s.atNewline = b == '\r' || b == '\n'
		}
	}
	return out, false
}

