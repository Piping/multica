package cli

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestHTTPToWSURL(t *testing.T) {
	cases := []struct {
		name    string
		base    string
		path    string
		want    string
		wantErr bool
	}{
		{
			name: "https → wss",
			base: "https://api.example.com",
			path: "/ws/issues/abc/terminal?workspace_id=ws1&cols=80",
			want: "wss://api.example.com/ws/issues/abc/terminal?workspace_id=ws1&cols=80",
		},
		{
			name: "http → ws",
			base: "http://localhost:8080",
			path: "/ws/issues/x/terminal",
			want: "ws://localhost:8080/ws/issues/x/terminal",
		},
		{
			name: "wss left alone",
			base: "wss://api.example.com",
			path: "/ws",
			want: "wss://api.example.com/ws",
		},
		{
			name: "trailing slash on base preserved correctly",
			base: "https://api.example.com/",
			path: "/ws/x",
			want: "wss://api.example.com/ws/x",
		},
		{
			name:    "missing leading slash on path",
			base:    "https://api.example.com",
			path:    "ws/x",
			wantErr: true,
		},
		{
			name:    "unsupported scheme",
			base:    "ftp://example.com",
			path:    "/ws",
			wantErr: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := httpToWSURL(tc.base, tc.path)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestDialWebSocketAttachesIdentityHeaders(t *testing.T) {
	upgrader := websocket.Upgrader{}
	gotHeaders := make(chan http.Header, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeaders <- r.Header.Clone()
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		conn.Close()
	}))
	defer server.Close()

	client := NewAPIClient(server.URL, "ws-uuid", "mul_test_token")
	client.Platform = "cli"
	client.Version = "1.2.3"
	client.OS = "macos"

	conn, _, err := client.DialWebSocket(context.Background(), "/ws")
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	headers := <-gotHeaders
	if got := headers.Get("X-Workspace-ID"); got != "ws-uuid" {
		t.Errorf("X-Workspace-ID = %q, want ws-uuid", got)
	}
	if got := headers.Get("X-Client-Platform"); got != "cli" {
		t.Errorf("X-Client-Platform = %q, want cli", got)
	}
	if got := headers.Get("X-Client-Version"); got != "1.2.3" {
		t.Errorf("X-Client-Version = %q, want 1.2.3", got)
	}
	if got := headers.Get("X-Client-OS"); got != "macos" {
		t.Errorf("X-Client-OS = %q, want macos", got)
	}
	if got := headers.Get("Authorization"); got != "" {
		// The server's terminal endpoint runs WS upgrade before any header
		// auth middleware, so the CLI must authenticate via the first frame
		// to match cookie-based browser clients. Sending a Bearer header
		// here would silently work in some setups and silently fail in
		// others — keep it consistent and absent.
		t.Errorf("Authorization header should NOT be set on WS dial, got %q", got)
	}
	if got := headers.Get("Sec-WebSocket-Key"); !strings.HasPrefix(strings.TrimSpace(got), "") || got == "" {
		t.Errorf("Sec-WebSocket-Key missing")
	}
}
