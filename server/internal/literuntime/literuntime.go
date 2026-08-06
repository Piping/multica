package literuntime

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/multica-ai/multica/server/pkg/agent"
)

const (
	defaultTimeout          = 30 * time.Minute
	defaultHandshakeTimeout = 30 * time.Second
)

// Options configures one lightweight local Codex-protocol run.
type Options struct {
	Project          string
	Bin              string
	Home             string
	Prompt           string
	PromptFile       string
	Model            string
	ThinkingLevel    string
	ServiceTier      string
	Timeout          time.Duration
	HandshakeTimeout time.Duration
	TaskID           string
	RuntimeID        string
	Logger           *slog.Logger
}

// Output is the JSON-friendly execution report returned by Run.
type Output struct {
	Runtime   string          `json:"runtime"`
	Project   string          `json:"project"`
	Bin       string          `json:"bin"`
	Home      string          `json:"home"`
	PromptLen int             `json:"prompt_len"`
	Result    Result          `json:"result"`
	Messages  []StreamMessage `json:"messages"`
	Profile   Profile         `json:"profile"`
}

// Result is the stable JSON projection of agent.Result.
type Result struct {
	Status         string                `json:"status"`
	Output         string                `json:"output,omitempty"`
	Error          string                `json:"error,omitempty"`
	DurationMs     int64                 `json:"duration_ms"`
	SessionID      string                `json:"session_id,omitempty"`
	Usage          map[string]TokenUsage `json:"usage,omitempty"`
	ResumeRejected bool                  `json:"resume_rejected,omitempty"`
}

// TokenUsage is the stable JSON projection of agent.TokenUsage.
type TokenUsage struct {
	InputTokens      int64 `json:"input_tokens"`
	OutputTokens     int64 `json:"output_tokens"`
	CacheReadTokens  int64 `json:"cache_read_tokens"`
	CacheWriteTokens int64 `json:"cache_write_tokens"`
	CostUSDTicks     int64 `json:"cost_usd_ticks,omitempty"`
}

// StreamMessage is a stable JSON representation of agent.Message.
type StreamMessage struct {
	Type      string         `json:"type"`
	Content   string         `json:"content,omitempty"`
	Tool      string         `json:"tool,omitempty"`
	CallID    string         `json:"call_id,omitempty"`
	Input     map[string]any `json:"input,omitempty"`
	Output    string         `json:"output,omitempty"`
	Status    string         `json:"status,omitempty"`
	Level     string         `json:"level,omitempty"`
	SessionID string         `json:"session_id,omitempty"`
	AtMs      int64          `json:"at_ms"`
}

// Profile records Multica-side wrapper timing. Codex app-server lifecycle
// details still come from the reused codex backend's structured logs.
type Profile struct {
	StartedAt    time.Time `json:"started_at"`
	CompletedAt  time.Time `json:"completed_at"`
	TotalMs      int64     `json:"total_ms"`
	PhaseTimings []Phase   `json:"phase_timings"`
}

// Phase is a single measured literuntime phase.
type Phase struct {
	Name       string `json:"name"`
	DurationMs int64  `json:"duration_ms"`
}

type profiler struct {
	start  time.Time
	phases []Phase
}

func newProfiler(now time.Time) *profiler {
	return &profiler{start: now}
}

func (p *profiler) phase(name string, fn func() error) error {
	start := time.Now()
	err := fn()
	p.phases = append(p.phases, Phase{
		Name:       name,
		DurationMs: time.Since(start).Milliseconds(),
	})
	return err
}

func (p *profiler) finish(now time.Time) Profile {
	return Profile{
		StartedAt:    p.start,
		CompletedAt:  now,
		TotalMs:      now.Sub(p.start).Milliseconds(),
		PhaseTimings: append([]Phase(nil), p.phases...),
	}
}

// Run executes one prompt through the Codex JSON-RPC app-server backend.
func Run(ctx context.Context, opts Options) (Output, error) {
	started := time.Now()
	profile := newProfiler(started)
	out := Output{Runtime: "literuntime-codex-jsonrpc"}

	var prompt string
	if err := profile.phase("validate", func() error {
		opts.Project = strings.TrimSpace(opts.Project)
		if opts.Project == "" {
			return errors.New("project is required")
		}
		absProject, err := filepath.Abs(opts.Project)
		if err != nil {
			return fmt.Errorf("resolve project: %w", err)
		}
		info, err := os.Stat(absProject)
		if err != nil {
			return fmt.Errorf("stat project: %w", err)
		}
		if !info.IsDir() {
			return fmt.Errorf("project is not a directory: %s", absProject)
		}
		opts.Project = absProject
		if strings.TrimSpace(opts.Bin) == "" {
			opts.Bin = "codex"
		}
		if strings.TrimSpace(opts.Home) == "" {
			opts.Home = filepath.Join(opts.Project, ".multica", "literuntime", "codex-home")
		}
		absHome, err := filepath.Abs(opts.Home)
		if err != nil {
			return fmt.Errorf("resolve home: %w", err)
		}
		opts.Home = absHome
		if strings.TrimSpace(opts.Prompt) == "" && strings.TrimSpace(opts.PromptFile) == "" {
			return errors.New("prompt or prompt-file is required")
		}
		if opts.Timeout <= 0 {
			opts.Timeout = defaultTimeout
		}
		if opts.HandshakeTimeout <= 0 {
			opts.HandshakeTimeout = defaultHandshakeTimeout
		}
		if opts.Logger == nil {
			opts.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
		}
		return nil
	}); err != nil {
		out.Profile = profile.finish(time.Now())
		return out, err
	}

	if err := profile.phase("read_prompt", func() error {
		if strings.TrimSpace(opts.PromptFile) == "" {
			prompt = opts.Prompt
			return nil
		}
		data, err := os.ReadFile(opts.PromptFile)
		if err != nil {
			return fmt.Errorf("read prompt-file: %w", err)
		}
		prompt = string(data)
		return nil
	}); err != nil {
		out.Profile = profile.finish(time.Now())
		return out, err
	}

	if err := profile.phase("create_home", func() error {
		return os.MkdirAll(opts.Home, 0o700)
	}); err != nil {
		out.Profile = profile.finish(time.Now())
		return out, fmt.Errorf("create CODEX_HOME: %w", err)
	}

	env := map[string]string{
		"CODEX_HOME": opts.Home,
	}
	for _, key := range []string{"TRAE_HOME", "TRAECLI_HOME"} {
		if value := os.Getenv(key); value != "" {
			env[key] = value
		}
	}

	var backend agent.Backend
	if err := profile.phase("start_backend", func() error {
		var err error
		backend, err = agent.New("codex", agent.Config{
			ExecutablePath: opts.Bin,
			Env:            env,
			Logger:         opts.Logger,
			TaskID:         valueOrDefault(opts.TaskID, "literuntime"),
			RuntimeID:      valueOrDefault(opts.RuntimeID, "literuntime"),
		})
		if err != nil {
			return err
		}
		return nil
	}); err != nil {
		out.Profile = profile.finish(time.Now())
		return out, err
	}

	out.Project = opts.Project
	out.Bin = opts.Bin
	out.Home = opts.Home
	out.PromptLen = len(prompt)

	var session *agent.Session
	if err := profile.phase("execute", func() error {
		var err error
		session, err = backend.Execute(ctx, prompt, agent.ExecOptions{
			Cwd:              opts.Project,
			Model:            opts.Model,
			Timeout:          opts.Timeout,
			HandshakeTimeout: opts.HandshakeTimeout,
			ThinkingLevel:    opts.ThinkingLevel,
			ServiceTier:      opts.ServiceTier,
		})
		return err
	}); err != nil {
		out.Profile = profile.finish(time.Now())
		return out, err
	}

	runStarted := time.Now()
	if err := profile.phase("stream", func() error {
		for msg := range session.Messages {
			out.Messages = append(out.Messages, StreamMessage{
				Type:      string(msg.Type),
				Content:   msg.Content,
				Tool:      msg.Tool,
				CallID:    msg.CallID,
				Input:     msg.Input,
				Output:    msg.Output,
				Status:    msg.Status,
				Level:     msg.Level,
				SessionID: msg.SessionID,
				AtMs:      time.Since(runStarted).Milliseconds(),
			})
		}
		return nil
	}); err != nil {
		out.Profile = profile.finish(time.Now())
		return out, err
	}

	if err := profile.phase("finalize", func() error {
		result, ok := <-session.Result
		if !ok {
			return errors.New("agent result channel closed without a result")
		}
		out.Result = projectResult(result)
		return nil
	}); err != nil {
		out.Profile = profile.finish(time.Now())
		return out, err
	}

	out.Profile = profile.finish(time.Now())
	return out, nil
}

func projectResult(result agent.Result) Result {
	usage := make(map[string]TokenUsage, len(result.Usage))
	for model, item := range result.Usage {
		usage[model] = TokenUsage{
			InputTokens:      item.InputTokens,
			OutputTokens:     item.OutputTokens,
			CacheReadTokens:  item.CacheReadTokens,
			CacheWriteTokens: item.CacheWriteTokens,
			CostUSDTicks:     item.CostUSDTicks,
		}
	}
	if len(usage) == 0 {
		usage = nil
	}
	return Result{
		Status:         result.Status,
		Output:         result.Output,
		Error:          result.Error,
		DurationMs:     result.DurationMs,
		SessionID:      result.SessionID,
		Usage:          usage,
		ResumeRejected: result.ResumeRejected,
	}
}

func valueOrDefault(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}
