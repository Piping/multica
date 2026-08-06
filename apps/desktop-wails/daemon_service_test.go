package main

import (
	"context"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestDaemonServiceShutdownStopsBackgroundWork(t *testing.T) {
	t.Parallel()

	service := newDaemonService()
	pollingStopped := make(chan struct{})
	logTailStopped := make(chan struct{})
	service.stopPolling = pollingStopped
	service.stopLogTail = logTailStopped

	if err := service.ServiceShutdown(); err != nil {
		t.Fatal(err)
	}
	assertClosed(t, pollingStopped)
	assertClosed(t, logTailStopped)
	if service.stopPolling != nil || service.stopLogTail != nil {
		t.Fatal("shutdown retained background channels")
	}

	if err := service.ServiceShutdown(); err != nil {
		t.Fatalf("repeated shutdown failed: %v", err)
	}
}

func TestDaemonServiceStartupCreatesPollingChannel(t *testing.T) {
	t.Parallel()

	service := newDaemonService()
	pollStarted := make(chan struct{})
	service.runPollLoop = func(stop <-chan struct{}) {
		close(pollStarted)
		<-stop
	}
	if err := service.ServiceStartup(
		context.Background(),
		application.ServiceOptions{},
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := service.ServiceShutdown(); err != nil {
			t.Error(err)
		}
	})

	service.mu.Lock()
	stopPolling := service.stopPolling
	service.mu.Unlock()
	if stopPolling == nil {
		t.Fatal("startup did not create the polling channel")
	}
	select {
	case <-pollStarted:
	case <-time.After(time.Second):
		t.Fatal("startup did not launch the polling loop")
	}
}

func assertClosed(t *testing.T, channel <-chan struct{}) {
	t.Helper()
	select {
	case <-channel:
	case <-time.After(time.Second):
		t.Fatal("channel was not closed")
	}
}

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
