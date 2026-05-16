package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/pkg/protocol"
)

func TestEscapeState_DetachOnFreshLine(t *testing.T) {
	s := &newlineState{atNewline: true}
	out, detach := s.process([]byte("~."), '~')
	if !detach {
		t.Fatalf("expected detach")
	}
	if len(out) != 0 {
		t.Fatalf("expected no bytes forwarded, got %q", out)
	}
}

func TestEscapeState_TildeNotAfterNewlineIsLiteral(t *testing.T) {
	s := &newlineState{atNewline: false}
	out, detach := s.process([]byte("foo~.bar"), '~')
	if detach {
		t.Fatalf("must not detach when ~ is mid-line")
	}
	if string(out) != "foo~.bar" {
		t.Fatalf("got %q", out)
	}
}

func TestEscapeState_DoubleTildeEmitsLiteral(t *testing.T) {
	s := &newlineState{atNewline: true}
	out, detach := s.process([]byte("~~"), '~')
	if detach {
		t.Fatalf("~~ must not detach")
	}
	if string(out) != "~" {
		t.Fatalf("got %q want ~", out)
	}
}

func TestEscapeState_StraddledChunks(t *testing.T) {
	// User pastes/types ~ and . in two separate stdin reads — escape
	// detection still works because state is preserved across calls.
	s := &newlineState{atNewline: true}
	out1, detach1 := s.process([]byte("~"), '~')
	if detach1 || len(out1) != 0 {
		t.Fatalf("first chunk: detach=%v out=%q", detach1, out1)
	}
	out2, detach2 := s.process([]byte("."), '~')
	if !detach2 {
		t.Fatalf("expected detach on second chunk")
	}
	if len(out2) != 0 {
		t.Fatalf("second chunk should forward nothing, got %q", out2)
	}
}

func TestEscapeState_DisabledWhenEscapeIsZero(t *testing.T) {
	s := &newlineState{atNewline: true}
	out, detach := s.process([]byte("~."), 0)
	if detach {
		t.Fatalf("disabled escape must not detach")
	}
	if string(out) != "~." {
		t.Fatalf("got %q want ~.", out)
	}
}

func TestEscapeState_UnknownEscapeForwardsBoth(t *testing.T) {
	s := &newlineState{atNewline: true}
	out, _ := s.process([]byte("~x"), '~')
	if string(out) != "~x" {
		t.Fatalf("got %q want ~x", out)
	}
}

func TestBuildTerminalPathAndQuery(t *testing.T) {
	got := buildTerminalPathAndQuery("MUL-2295", "ws-uuid", 120, 40)
	u, err := url.Parse("http://x" + got)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if u.Path != "/ws/issues/MUL-2295/terminal" {
		t.Errorf("path = %q", u.Path)
	}
	q := u.Query()
	if q.Get("workspace_id") != "ws-uuid" {
		t.Errorf("workspace_id = %q", q.Get("workspace_id"))
	}
	if q.Get("cols") != "120" {
		t.Errorf("cols = %q", q.Get("cols"))
	}
	if q.Get("rows") != "40" {
		t.Errorf("rows = %q", q.Get("rows"))
	}
}

// fakeServer simulates the Phase 2 /ws/issues/{id}/terminal handshake plus
// a tiny echo loop, so we can drive the CLI proxy through its full lifecycle
// in-process without spinning up the real daemon.
type fakeServer struct {
	t           *testing.T
	upgrader    websocket.Upgrader
	gotAuth     chan string
	gotData     chan []byte
	gotClose    chan string
	sessionID   string
	server      *httptest.Server
	connMu      sync.Mutex
	conn        *websocket.Conn
	sendOpenErr *protocol.TerminalErrorPayload // if set, send terminal.error instead of terminal.opened
}

// writeFrame serializes writes from the handler goroutine and any test
// goroutine that wants to push a frame to the connected client. Required
// because gorilla/websocket allows concurrent read+write but NOT concurrent
// writes from different goroutines.
func (fs *fakeServer) writeFrame(frame []byte) error {
	fs.connMu.Lock()
	defer fs.connMu.Unlock()
	if fs.conn == nil {
		return fmt.Errorf("no client")
	}
	return fs.conn.WriteMessage(websocket.TextMessage, frame)
}

func newFakeServer(t *testing.T) *fakeServer {
	fs := &fakeServer{
		t:         t,
		upgrader:  websocket.Upgrader{},
		gotAuth:   make(chan string, 1),
		gotData:   make(chan []byte, 32),
		gotClose:  make(chan string, 1),
		sessionID: "session-xyz",
	}
	fs.server = httptest.NewServer(http.HandlerFunc(fs.handle))
	return fs
}

func (fs *fakeServer) close() {
	fs.connMu.Lock()
	c := fs.conn
	fs.connMu.Unlock()
	if c != nil {
		c.Close()
	}
	fs.server.Close()
}

func (fs *fakeServer) baseURL() string { return fs.server.URL }

func (fs *fakeServer) handle(w http.ResponseWriter, r *http.Request) {
	conn, err := fs.upgrader.Upgrade(w, r, nil)
	if err != nil {
		fs.t.Errorf("upgrade: %v", err)
		return
	}
	fs.connMu.Lock()
	fs.conn = conn
	fs.connMu.Unlock()

	// 1. Auth.
	_, raw, err := conn.ReadMessage()
	if err != nil {
		return
	}
	var auth struct {
		Type    string         `json:"type"`
		Payload map[string]any `json:"payload"`
	}
	if err := json.Unmarshal(raw, &auth); err != nil || auth.Type != "auth" {
		_ = fs.writeFrame([]byte(`{"error":"bad auth"}`))
		return
	}
	tok, _ := auth.Payload["token"].(string)
	fs.gotAuth <- tok
	_ = fs.writeFrame([]byte(`{"type":"auth_ack"}`))

	// 2. Open ack.
	if fs.sendOpenErr != nil {
		ep := *fs.sendOpenErr
		frame, _ := marshalCLITerminalFrame(protocol.MessageTypeTerminalError, ep)
		_ = fs.writeFrame(frame)
		return
	}
	openedFrame, _ := marshalCLITerminalFrame(protocol.MessageTypeTerminalOpened, protocol.TerminalOpenedPayload{
		SessionID: fs.sessionID,
		WorkDir:   "/tmp/work",
		Shell:     "/bin/bash",
	})
	_ = fs.writeFrame(openedFrame)

	// 3. Pump.
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
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
			data, _ := base64.StdEncoding.DecodeString(pl.DataB64)
			fs.gotData <- data
			// Echo back so the CLI's stdout pump has something to do.
			echo, _ := marshalCLITerminalFrame(protocol.MessageTypeTerminalData, protocol.TerminalDataPayload{
				SessionID: fs.sessionID,
				DataB64:   pl.DataB64,
			})
			_ = fs.writeFrame(echo)
		case protocol.MessageTypeTerminalClose:
			var pl protocol.TerminalClosePayload
			_ = json.Unmarshal(env.Payload, &pl)
			fs.gotClose <- pl.Reason
			return
		case protocol.MessageTypeTerminalResize:
			// observed but unused in this fake
		}
	}
}

func newTestCmd() *cobra.Command {
	c := &cobra.Command{}
	c.Flags().String("escape-char", "~", "")
	c.Flags().Bool("no-raw", true, "")
	return c
}

func TestCLITerminalProxy_HandshakeAndEcho(t *testing.T) {
	fs := newFakeServer(t)
	defer fs.close()

	wsURL := strings.Replace(fs.baseURL(), "http://", "ws://", 1) + "/"
	dialer := *websocket.DefaultDialer
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	stdinR, stdinW := io.Pipe()
	stdout := newSafeBuffer()
	stderr := newSafeBuffer()

	cmd := newTestCmd()
	p := newCLITerminalProxy(conn, stdinR, stdout, stderr, "mul_test", cmd)

	// Drive handshake explicitly so we can also assert the auth token reached
	// the fake server.
	if err := p.handshake(); err != nil {
		t.Fatalf("handshake: %v", err)
	}
	select {
	case got := <-fs.gotAuth:
		if got != "mul_test" {
			t.Errorf("auth token = %q, want mul_test", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("server did not receive auth frame")
	}
	if p.SessionID() != fs.sessionID {
		t.Fatalf("session_id = %q, want %q", p.SessionID(), fs.sessionID)
	}

	// Now run the pumps in a goroutine.
	pumpsDone := make(chan struct{})
	go func() {
		go p.readPump()
		p.stdinPump(false)
		close(pumpsDone)
	}()

	// Send "hello" through stdin; expect server to receive it and echo it
	// back into stdout.
	if _, err := stdinW.Write([]byte("hello")); err != nil {
		t.Fatalf("stdin write: %v", err)
	}

	select {
	case got := <-fs.gotData:
		if string(got) != "hello" {
			t.Fatalf("server got %q, want hello", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("server did not receive data")
	}

	// Wait for the echo to land in stdout.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(stdout.String(), "hello") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !strings.Contains(stdout.String(), "hello") {
		t.Fatalf("stdout missing echo, got %q", stdout.String())
	}

	// Trigger detach: send "\n~." after a newline. Because stdinPump starts
	// the state machine at atNewline=true on the very first byte, we need
	// to walk through a real newline first to make the test realistic.
	if _, err := stdinW.Write([]byte("\n~.")); err != nil {
		t.Fatalf("stdin write detach: %v", err)
	}

	select {
	case <-pumpsDone:
	case <-time.After(3 * time.Second):
		t.Fatal("stdin pump did not exit after detach")
	}

	select {
	case reason := <-fs.gotClose:
		if reason != "client_detach" {
			t.Errorf("close reason = %q, want client_detach", reason)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("server did not receive terminal.close on detach")
	}

	// run() prints the exit message to stderr; in this lower-level test we
	// drive the pumps directly, so check the captured exit message.
	msgPtr := p.exitMsg.Load()
	if msgPtr == nil || !strings.Contains(*msgPtr, "detached") {
		got := ""
		if msgPtr != nil {
			got = *msgPtr
		}
		t.Errorf("exit msg = %q, want detach text", got)
	}
}

// safeBuffer is a tiny mutex-wrapped bytes.Buffer for tests that read from
// the buffer in one goroutine while another writes (race-detector-clean).
type safeBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func newSafeBuffer() *safeBuffer { return &safeBuffer{} }

func (b *safeBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *safeBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func TestCLITerminalProxy_HandshakeRejectedOnTerminalError(t *testing.T) {
	fs := newFakeServer(t)
	fs.sendOpenErr = &protocol.TerminalErrorPayload{
		Code:    protocol.TerminalErrorCodeTaskNotFound,
		Message: "no agent task on this issue",
	}
	defer fs.close()

	wsURL := strings.Replace(fs.baseURL(), "http://", "ws://", 1) + "/"
	dialer := *websocket.DefaultDialer
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	cmd := newTestCmd()
	p := newCLITerminalProxy(conn, strings.NewReader(""), io.Discard, io.Discard, "mul_test", cmd)
	err = p.handshake()
	if err == nil {
		t.Fatal("expected handshake error, got nil")
	}
	if !strings.Contains(err.Error(), protocol.TerminalErrorCodeTaskNotFound) {
		t.Errorf("error %q does not mention error code", err)
	}
}

func TestCLITerminalProxy_AuthRejected(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		// Read auth frame, reply with error.
		_, _, _ = conn.ReadMessage()
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"error":"invalid token"}`))
	}))
	defer server.Close()

	wsURL := strings.Replace(server.URL, "http://", "ws://", 1) + "/"
	dialer := *websocket.DefaultDialer
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	cmd := newTestCmd()
	p := newCLITerminalProxy(conn, strings.NewReader(""), io.Discard, io.Discard, "mul_test", cmd)
	err = p.handshake()
	if err == nil {
		t.Fatal("expected handshake error, got nil")
	}
	if !strings.Contains(err.Error(), "invalid token") {
		t.Errorf("error %q does not surface server reason", err)
	}
}

func TestCLITerminalProxy_TerminalExitDeliversCode(t *testing.T) {
	// Driver: open server, advance through handshake, then push a
	// terminal.exit frame and verify the proxy's exit code state.
	fs := newFakeServer(t)
	defer fs.close()

	wsURL := strings.Replace(fs.baseURL(), "http://", "ws://", 1) + "/"
	dialer := *websocket.DefaultDialer
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	cmd := newTestCmd()
	p := newCLITerminalProxy(conn, strings.NewReader(""), io.Discard, io.Discard, "mul_test", cmd)
	if err := p.handshake(); err != nil {
		t.Fatalf("handshake: %v", err)
	}

	exitFrame, _ := marshalCLITerminalFrame(protocol.MessageTypeTerminalExit, protocol.TerminalExitPayload{
		SessionID: fs.sessionID,
		ExitCode:  42,
		Reason:    "child exited",
	})

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		p.readPump()
	}()
	if err := fs.writeFrame(exitFrame); err != nil {
		t.Fatalf("server write exit: %v", err)
	}

	doneAt := time.Now().Add(2 * time.Second)
	for time.Now().Before(doneAt) {
		if p.exitCode.Load() == 42 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	wg.Wait()
	if got := p.exitCode.Load(); got != 42 {
		t.Fatalf("exit code = %d, want 42", got)
	}
	msgPtr := p.exitMsg.Load()
	if msgPtr == nil || !strings.Contains(*msgPtr, "exit code 42") {
		got := ""
		if msgPtr != nil {
			got = *msgPtr
		}
		t.Errorf("exit msg = %q", got)
	}
}

// Compile-time check: ensure the marshaled frame round-trips through the
// real protocol.Message envelope. Catches any drift if the protocol pkg
// renames a field.
func TestMarshalCLITerminalFrame_EnvelopeShape(t *testing.T) {
	frame, err := marshalCLITerminalFrame(protocol.MessageTypeTerminalResize, protocol.TerminalResizePayload{
		SessionID: "sid",
		Cols:      100,
		Rows:      30,
	})
	if err != nil {
		t.Fatal(err)
	}
	var env protocol.Message
	if err := json.Unmarshal(frame, &env); err != nil {
		t.Fatal(err)
	}
	if env.Type != protocol.MessageTypeTerminalResize {
		t.Fatalf("type = %q", env.Type)
	}
	var pl protocol.TerminalResizePayload
	if err := json.Unmarshal(env.Payload, &pl); err != nil {
		t.Fatal(err)
	}
	if pl.Cols != 100 || pl.Rows != 30 || pl.SessionID != "sid" {
		t.Fatalf("payload = %+v", pl)
	}
}

// Sanity check the help string does not crash on a zero escape byte.
func TestEscapeHelpString(t *testing.T) {
	if got := escapeHelpString(0); got != "(disabled)" {
		t.Errorf("escape disabled hint = %q", got)
	}
	if got := escapeHelpString('~'); !strings.Contains(got, "~") {
		t.Errorf("escape help = %q", got)
	}
}

