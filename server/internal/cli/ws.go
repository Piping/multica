package cli

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/gorilla/websocket"
)

// DialWebSocket opens a WebSocket connection to the server at the given path
// + query string. The path must start with "/". Auth is intentionally NOT
// sent as a header here: the server's terminal endpoint runs WS upgrade
// before applying header-based auth middleware (browsers cannot set
// Authorization on a WS upgrade), so the caller authenticates via the
// first-frame `auth` message instead. The standard X-Workspace-ID /
// X-Client-* identity headers are still attached so dashboards can attribute
// the connection to the right CLI build.
func (c *APIClient) DialWebSocket(ctx context.Context, pathAndQuery string) (*websocket.Conn, *http.Response, error) {
	if c.BaseURL == "" {
		return nil, nil, fmt.Errorf("APIClient has no BaseURL")
	}
	wsURL, err := httpToWSURL(c.BaseURL, pathAndQuery)
	if err != nil {
		return nil, nil, err
	}

	header := http.Header{}
	c.setWSHeaders(header)

	dialer := *websocket.DefaultDialer
	conn, resp, err := dialer.DialContext(ctx, wsURL, header)
	if err != nil {
		return nil, resp, err
	}
	return conn, resp, nil
}

// setWSHeaders attaches identity headers but deliberately omits the
// Authorization header. Auth happens in-band via the first frame so this
// stays consistent with cookie-based browser clients.
func (c *APIClient) setWSHeaders(h http.Header) {
	if c.WorkspaceID != "" {
		h.Set("X-Workspace-ID", c.WorkspaceID)
	}
	platform := c.Platform
	if platform == "" {
		platform = ClientPlatform
	}
	if platform != "" {
		h.Set("X-Client-Platform", platform)
	}
	version := c.Version
	if version == "" {
		version = ClientVersion
	}
	if version != "" {
		h.Set("X-Client-Version", version)
	}
	osName := c.OS
	if osName == "" {
		osName = ClientOS
	}
	if osName != "" {
		h.Set("X-Client-OS", osName)
	}
}

func httpToWSURL(baseURL, pathAndQuery string) (string, error) {
	u, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("parse base URL: %w", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	case "ws", "wss":
		// already WS
	default:
		return "", fmt.Errorf("unsupported base URL scheme %q", u.Scheme)
	}
	if !strings.HasPrefix(pathAndQuery, "/") {
		return "", fmt.Errorf("path must start with /, got %q", pathAndQuery)
	}
	suffix, err := url.Parse(pathAndQuery)
	if err != nil {
		return "", fmt.Errorf("parse path/query: %w", err)
	}
	u.Path = strings.TrimRight(u.Path, "/") + suffix.Path
	u.RawQuery = suffix.RawQuery
	u.Fragment = ""
	return u.String(), nil
}
