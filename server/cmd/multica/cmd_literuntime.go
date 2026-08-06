package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/multica-ai/multica/server/internal/literuntime"
)

var literuntimeCmd = &cobra.Command{
	Use:   "literuntime",
	Short: "Run the experimental lightweight local agent runtime",
}

var literuntimeRunCmd = &cobra.Command{
	Use:   "run [prompt]",
	Short: "Run a prompt through a local Codex JSON-RPC app-server",
	Args:  cobra.MaximumNArgs(1),
	RunE:  runLiteruntimeRun,
}

func init() {
	literuntimeCmd.AddCommand(literuntimeRunCmd)

	literuntimeRunCmd.Flags().String("project", ".", "Project directory used as the agent cwd")
	literuntimeRunCmd.Flags().String("bin", "", "Codex-compatible executable to run (env: MULTICA_LITERUNTIME_BIN, default: codex)")
	literuntimeRunCmd.Flags().String("home", "", "Persistent CODEX_HOME directory (default: <project>/.multica/literuntime/codex-home)")
	literuntimeRunCmd.Flags().String("prompt-file", "", "Read prompt text from a file instead of the prompt argument")
	literuntimeRunCmd.Flags().String("model", "", "Model override passed to thread/start")
	literuntimeRunCmd.Flags().String("thinking-level", "", "Reasoning effort override passed to Codex")
	literuntimeRunCmd.Flags().String("service-tier", "", "Codex service tier override")
	literuntimeRunCmd.Flags().Duration("timeout", 30*time.Minute, "Execution timeout")
	literuntimeRunCmd.Flags().Duration("handshake-timeout", 30*time.Second, "JSON-RPC handshake timeout")
	literuntimeRunCmd.Flags().String("output", "json", "Output format: json")
}

func runLiteruntimeRun(cmd *cobra.Command, args []string) error {
	output, _ := cmd.Flags().GetString("output")
	if output != "json" {
		return fmt.Errorf("--output must be json")
	}

	project, _ := cmd.Flags().GetString("project")
	bin, _ := cmd.Flags().GetString("bin")
	if strings.TrimSpace(bin) == "" {
		bin = os.Getenv("MULTICA_LITERUNTIME_BIN")
	}
	home, _ := cmd.Flags().GetString("home")
	promptFile, _ := cmd.Flags().GetString("prompt-file")
	model, _ := cmd.Flags().GetString("model")
	thinkingLevel, _ := cmd.Flags().GetString("thinking-level")
	serviceTier, _ := cmd.Flags().GetString("service-tier")
	timeout, _ := cmd.Flags().GetDuration("timeout")
	handshakeTimeout, _ := cmd.Flags().GetDuration("handshake-timeout")

	prompt := ""
	if len(args) > 0 {
		prompt = args[0]
	}

	result, err := literuntime.Run(context.Background(), literuntime.Options{
		Project:          project,
		Bin:              bin,
		Home:             home,
		Prompt:           prompt,
		PromptFile:       promptFile,
		Model:            model,
		ThinkingLevel:    thinkingLevel,
		ServiceTier:      serviceTier,
		Timeout:          timeout,
		HandshakeTimeout: handshakeTimeout,
		TaskID:           "literuntime-cli",
		RuntimeID:        "literuntime-cli",
		Logger:           slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		return err
	}
	return cli.PrintJSON(os.Stdout, result)
}
