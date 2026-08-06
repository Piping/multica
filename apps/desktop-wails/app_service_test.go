package main

import "testing"

func TestParseIssueWindowRequest(t *testing.T) {
	t.Parallel()

	context, ok := parseIssueWindowRequest(issueWindowRequest{
		Path:  "/acme/issues/ISS-42?view=activity",
		Title: "  Runtime failure  ",
	})
	if !ok {
		t.Fatal("expected valid issue request")
	}
	if context.Kind != "issue" || context.WorkspaceSlug != "acme" || context.IssueID != "ISS-42" {
		t.Fatalf("unexpected context: %#v", context)
	}
	if context.Title != "Runtime failure" {
		t.Fatalf("unexpected title %q", context.Title)
	}

	for _, path := range []string{
		"https://example.com/acme/issues/ISS-42",
		"/acme/projects/project-1",
		"/ACME/issues/ISS-42",
		"/acme/issues/invalid.ref",
	} {
		if _, valid := parseIssueWindowRequest(issueWindowRequest{Path: path}); valid {
			t.Fatalf("expected %q to be rejected", path)
		}
	}
}

func TestRuntimeURLDerivation(t *testing.T) {
	t.Parallel()

	if got := deriveWSURL("https://api.example.com/base"); got != "wss://api.example.com/base/ws" {
		t.Fatalf("deriveWSURL() = %q", got)
	}
	if got := deriveAppURL("https://api.example.com", false); got != "https://example.com" {
		t.Fatalf("deriveAppURL() = %q", got)
	}
	if got := deriveAppURL("http://localhost:8080", true); got != "http://localhost:3000" {
		t.Fatalf("deriveAppURL(dev) = %q", got)
	}
}

func TestValidateRuntimeConfig(t *testing.T) {
	t.Parallel()

	result := validateRuntimeConfig(runtimeConfig{
		SchemaVersion: 1,
		APIURL:        "https://api.example.com/",
	})
	if !result.OK || result.Config == nil {
		t.Fatalf("expected valid config, got %#v", result)
	}
	if result.Config.WSURL != "wss://api.example.com/ws" {
		t.Fatalf("unexpected websocket URL %q", result.Config.WSURL)
	}
	if result.Config.AppURL != "https://example.com" {
		t.Fatalf("unexpected app URL %q", result.Config.AppURL)
	}

	invalid := validateRuntimeConfig(runtimeConfig{
		SchemaVersion: 1,
		APIURL:        "file:///tmp/multica",
	})
	if invalid.OK || invalid.Error == nil {
		t.Fatalf("expected invalid config, got %#v", invalid)
	}
}
