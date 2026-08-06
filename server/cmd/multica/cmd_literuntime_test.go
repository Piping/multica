package main

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestLiteruntimeCommandsRegistered(t *testing.T) {
	cmd, _, err := rootCmd.Find([]string{"literuntime", "run"})
	if err != nil {
		t.Fatalf("find literuntime run: %v", err)
	}
	if cmd == nil || cmd.Name() != "run" {
		t.Fatalf("literuntime run not registered: %#v", cmd)
	}
}

func TestRunLiteruntimeRunPrintsJSON(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script fixture is POSIX-only")
	}

	project := t.TempDir()
	home := filepath.Join(t.TempDir(), "home")
	argvPath := filepath.Join(t.TempDir(), "argv.txt")
	fakePath := writeLiteRuntimeFakeCodex(t, argvPath)

	cmd := newLiteruntimeRunTestCmd()
	_ = cmd.Flags().Set("project", project)
	_ = cmd.Flags().Set("bin", fakePath)
	_ = cmd.Flags().Set("home", home)
	_ = cmd.Flags().Set("timeout", "5s")
	_ = cmd.Flags().Set("handshake-timeout", "2s")

	out, err := captureLiteruntimeStdout(t, func() error {
		return runLiteruntimeRun(cmd, []string{"hello"})
	})
	if err != nil {
		t.Fatalf("runLiteruntimeRun: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("decode output JSON %q: %v", out, err)
	}
	if got["runtime"] != "literuntime-codex-jsonrpc" {
		t.Fatalf("runtime = %#v", got["runtime"])
	}
	if got["home"] != home {
		t.Fatalf("home = %#v, want %q", got["home"], home)
	}
	result, ok := got["result"].(map[string]any)
	if !ok {
		t.Fatalf("missing result object: %#v", got)
	}
	if result["status"] != "completed" || result["output"] != "cli fake final" {
		t.Fatalf("result = %#v", result)
	}

	argvRaw, err := os.ReadFile(argvPath)
	if err != nil {
		t.Fatalf("read argv: %v", err)
	}
	if strings.TrimSpace(string(argvRaw)) != "app-server|--listen|stdio://" {
		t.Fatalf("argv = %q, want codex app-server stdio launch", string(argvRaw))
	}
}

func newLiteruntimeRunTestCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "run"}
	cmd.Flags().String("project", ".", "")
	cmd.Flags().String("bin", "", "")
	cmd.Flags().String("home", "", "")
	cmd.Flags().String("prompt-file", "", "")
	cmd.Flags().String("model", "", "")
	cmd.Flags().String("thinking-level", "", "")
	cmd.Flags().String("service-tier", "", "")
	cmd.Flags().Duration("timeout", 0, "")
	cmd.Flags().Duration("handshake-timeout", 0, "")
	cmd.Flags().String("output", "json", "")
	return cmd
}

func captureLiteruntimeStdout(t *testing.T, fn func() error) (string, error) {
	t.Helper()
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe stdout: %v", err)
	}
	os.Stdout = w
	defer func() { os.Stdout = old }()

	runErr := fn()
	if err := w.Close(); err != nil {
		t.Fatalf("close stdout writer: %v", err)
	}
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("read stdout: %v", err)
	}
	return string(out), runErr
}

func writeLiteRuntimeFakeCodex(t *testing.T, argvPath string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "codex")
	script := "#!/bin/sh\n" +
		"printf '%s|%s|%s\\n' \"$1\" \"$2\" \"$3\" > " + shellQuoteForLiteRuntimeTest(argvPath) + "\n" +
		"if [ \"$1\" != \"app-server\" ] || [ \"$2\" != \"--listen\" ] || [ \"$3\" != \"stdio://\" ]; then exit 64; fi\n" +
		"read line\n" +
		"echo '{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}'\n" +
		"read line\n" +
		"read line\n" +
		"echo '{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"thread\":{\"id\":\"thr-cli\"}}}'\n" +
		"read line\n" +
		"echo '{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{}}'\n" +
		"echo '{\"jsonrpc\":\"2.0\",\"method\":\"turn/started\",\"params\":{\"threadId\":\"thr-cli\",\"turn\":{\"id\":\"turn-cli\"}}}'\n" +
		"echo '{\"jsonrpc\":\"2.0\",\"method\":\"item/completed\",\"params\":{\"threadId\":\"thr-cli\",\"item\":{\"id\":\"msg-cli\",\"type\":\"agentMessage\",\"text\":\"cli fake final\",\"phase\":\"final_answer\"}}}'\n" +
		"echo '{\"jsonrpc\":\"2.0\",\"method\":\"turn/completed\",\"params\":{\"threadId\":\"thr-cli\",\"turn\":{\"id\":\"turn-cli\",\"status\":\"completed\"}}}'\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake codex: %v", err)
	}
	return path
}

func shellQuoteForLiteRuntimeTest(path string) string {
	return "'" + strings.ReplaceAll(path, "'", "'\\''") + "'"
}
