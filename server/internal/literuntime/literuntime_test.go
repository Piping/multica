package literuntime

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestRunUsesCodexAppServerAndProfiles(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fixture is POSIX-only")
	}

	project := t.TempDir()
	argvPath := filepath.Join(t.TempDir(), "argv.txt")
	fakePath := writeFakeCodexAppServer(t, argvPath)

	out, err := Run(context.Background(), Options{
		Project:          project,
		Bin:              fakePath,
		Prompt:           "say hello",
		Timeout:          5 * time.Second,
		HandshakeTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	if out.Result.Status != "completed" {
		t.Fatalf("status = %q error=%q", out.Result.Status, out.Result.Error)
	}
	if out.Result.Output != "done from fake app-server" {
		t.Fatalf("output = %q", out.Result.Output)
	}
	if out.Result.SessionID != "thr-lite" {
		t.Fatalf("session id = %q", out.Result.SessionID)
	}
	if out.Result.Usage["unknown"].InputTokens != 1 ||
		out.Result.Usage["unknown"].CacheReadTokens != 1 ||
		out.Result.Usage["unknown"].OutputTokens != 3 {
		t.Fatalf("usage = %#v", out.Result.Usage)
	}
	if out.Project != project {
		t.Fatalf("project = %q, want %q", out.Project, project)
	}
	wantHome := filepath.Join(project, ".multica", "literuntime", "codex-home")
	if out.Home != wantHome {
		t.Fatalf("home = %q, want %q", out.Home, wantHome)
	}
	if info, err := os.Stat(wantHome); err != nil || !info.IsDir() {
		t.Fatalf("default home not created: info=%v err=%v", info, err)
	}
	if out.PromptLen != len("say hello") {
		t.Fatalf("prompt len = %d", out.PromptLen)
	}
	if len(out.Messages) == 0 {
		t.Fatal("expected streamed messages")
	}
	if out.Messages[0].Type != "status" || out.Messages[0].Status != "running" {
		t.Fatalf("first message = %#v, want running status", out.Messages[0])
	}
	if !hasProfilePhase(out.Profile.PhaseTimings, "validate") ||
		!hasProfilePhase(out.Profile.PhaseTimings, "create_home") ||
		!hasProfilePhase(out.Profile.PhaseTimings, "execute") ||
		!hasProfilePhase(out.Profile.PhaseTimings, "stream") ||
		!hasProfilePhase(out.Profile.PhaseTimings, "finalize") {
		t.Fatalf("missing expected profile phases: %#v", out.Profile.PhaseTimings)
	}
	if out.Profile.TotalMs < 0 || out.Profile.StartedAt.IsZero() || out.Profile.CompletedAt.IsZero() {
		t.Fatalf("invalid profile: %#v", out.Profile)
	}

	argvRaw, err := os.ReadFile(argvPath)
	if err != nil {
		t.Fatalf("read argv: %v", err)
	}
	if strings.TrimSpace(string(argvRaw)) != "app-server|--listen|stdio://" {
		t.Fatalf("argv = %q, want codex app-server stdio launch", string(argvRaw))
	}

	data, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("marshal output: %v", err)
	}
	if !strings.Contains(string(data), "literuntime-codex-jsonrpc") {
		t.Fatalf("json output missing runtime marker: %s", data)
	}
}

func TestRunReadsPromptFileAndCustomHome(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fixture is POSIX-only")
	}

	project := t.TempDir()
	home := filepath.Join(t.TempDir(), "codex-home")
	promptFile := filepath.Join(t.TempDir(), "prompt.txt")
	if err := os.WriteFile(promptFile, []byte("from file"), 0o600); err != nil {
		t.Fatalf("write prompt file: %v", err)
	}
	fakePath := writeFakeCodexAppServer(t, filepath.Join(t.TempDir(), "argv.txt"))

	out, err := Run(context.Background(), Options{
		Project:          project,
		Bin:              fakePath,
		Home:             home,
		PromptFile:       promptFile,
		Timeout:          5 * time.Second,
		HandshakeTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out.Home != home {
		t.Fatalf("home = %q, want %q", out.Home, home)
	}
	if out.PromptLen != len("from file") {
		t.Fatalf("prompt len = %d", out.PromptLen)
	}
}

func writeFakeCodexAppServer(t *testing.T, argvPath string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "codex")
	script := "#!/bin/sh\n" +
		"printf '%s|%s|%s\\n' \"$1\" \"$2\" \"$3\" > " + shellQuote(argvPath) + "\n" +
		"if [ \"$1\" != \"app-server\" ] || [ \"$2\" != \"--listen\" ] || [ \"$3\" != \"stdio://\" ]; then exit 64; fi\n" +
		"read line\n" +
		"echo '{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}'\n" +
		"read line\n" +
		"read line\n" +
		"echo '{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"thread\":{\"id\":\"thr-lite\"}}}'\n" +
		"read line\n" +
		"echo '{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{}}'\n" +
		"echo '{\"jsonrpc\":\"2.0\",\"method\":\"turn/started\",\"params\":{\"threadId\":\"thr-lite\",\"turn\":{\"id\":\"turn-lite\"}}}'\n" +
		"echo '{\"jsonrpc\":\"2.0\",\"method\":\"item/completed\",\"params\":{\"threadId\":\"thr-lite\",\"item\":{\"id\":\"msg-lite\",\"type\":\"agentMessage\",\"text\":\"done from fake app-server\",\"phase\":\"final_answer\"}}}'\n" +
		"echo '{\"jsonrpc\":\"2.0\",\"method\":\"turn/completed\",\"params\":{\"threadId\":\"thr-lite\",\"turn\":{\"id\":\"turn-lite\",\"status\":\"completed\",\"usage\":{\"input_tokens\":2,\"cached_input_tokens\":1,\"output_tokens\":3}}}}'\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake codex: %v", err)
	}
	return path
}

func hasProfilePhase(phases []Phase, name string) bool {
	for _, phase := range phases {
		if phase.Name == name {
			return true
		}
	}
	return false
}

func shellQuote(path string) string {
	return "'" + strings.ReplaceAll(path, "'", "'\\''") + "'"
}
