package main

import "testing"

func TestHealthPortForProfile(t *testing.T) {
	t.Parallel()

	if got := healthPortForProfile(""); got != defaultHealthPort {
		t.Fatalf("default profile port = %d", got)
	}

	profile := "desktop-api.example.com"
	sum := 0
	for _, value := range []byte(profile) {
		sum += int(value)
	}
	want := defaultHealthPort + 1 + (sum % 1000)
	if got := healthPortForProfile(profile); got != want {
		t.Fatalf("named profile port = %d, want %d", got, want)
	}
}

func TestRuntimeProbe(t *testing.T) {
	t.Parallel()

	probe := runtimeProbe([]string{"Codex", "claude", "codex", ""}, true)
	if probe.ProbeResult != "success" || probe.RuntimeCount != 3 {
		t.Fatalf("unexpected probe: %#v", probe)
	}
	if probe.ProviderSummary["codex"] != 2 || probe.ProviderSummary["claude"] != 1 {
		t.Fatalf("unexpected provider summary: %#v", probe.ProviderSummary)
	}
	if probe.OnlineCount != 3 || probe.OfflineCount != 0 {
		t.Fatalf("unexpected online counts: %#v", probe)
	}
}
