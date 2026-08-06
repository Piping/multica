package main

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/go-chi/cors"
	"github.com/multica-ai/multica/server/internal/handler"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func TestCORSAllowsPackagedWailsDesktopOrigin(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://multica.example")
	origins := allowedOrigins()
	for _, want := range []string{
		"https://multica.example",
		"wails://localhost",
		"http://wails.localhost",
	} {
		if !slices.Contains(origins, want) {
			t.Fatalf("%q missing from allowed origins: %v", want, origins)
		}
	}

	middleware := cors.Handler(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{"POST", "OPTIONS"},
		AllowedHeaders:   corsAllowedHeaders,
		AllowCredentials: true,
	})
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	request := httptest.NewRequest(http.MethodOptions, "/auth/send-code", nil)
	request.Header.Set("Origin", "wails://localhost")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "content-type,x-request-id,x-client-platform")
	response := httptest.NewRecorder()

	middleware(next).ServeHTTP(response, request)

	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "wails://localhost" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("Access-Control-Allow-Credentials = %q", got)
	}
}

// The app advertises its capabilities on the cancel request (#5219). Browsers
// preflight a custom request header, so an entry missing from AllowedHeaders is
// not a degraded feature — it is a failed request: the cancel never reaches the
// server, and the user's prompt is lost in a way no server-side test can see.
func TestCORSAllowedHeaders_IncludeClientCapabilities(t *testing.T) {
	if !slices.Contains(corsAllowedHeaders, "X-Client-Capabilities") {
		t.Fatalf("X-Client-Capabilities missing from CORS allowed headers: %v", corsAllowedHeaders)
	}
	// Named so the constant and the header travel together: the capability is
	// useless if the header carrying it cannot cross the preflight.
	if protocol.AppCapabilityChatDraftRestoreV1 == "" {
		t.Fatal("AppCapabilityChatDraftRestoreV1 must be a non-empty capability token")
	}
}

// Timeline and comment-list endpoints report defensive hard-cap clamps with
// custom response headers.
// Custom response headers are not readable from browser JS unless the server
// exposes them, and only the CORS-safelisted headers are exposed by default — so
// an entry missing here is not a degraded signal, it is no signal at all: the
// header arrives on the wire and the client cannot see it (MUL-5492).
func TestCORSExposedHeaders_IncludeTruncationSignals(t *testing.T) {
	for _, want := range []string{
		handler.HeaderCommentsTruncated,
		handler.HeaderTimelineTruncated,
	} {
		if !slices.Contains(corsExposedHeaders, want) {
			t.Errorf("%s missing from CORS exposed headers: %v", want, corsExposedHeaders)
		}
	}
}
