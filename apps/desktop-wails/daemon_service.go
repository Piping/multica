package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	defaultHealthPort  = 19514
	daemonPollInterval = 5 * time.Second
)

type daemonStatus struct {
	State             string   `json:"state"`
	PID               int      `json:"pid,omitempty"`
	Uptime            string   `json:"uptime,omitempty"`
	DaemonID          string   `json:"daemonId,omitempty"`
	DeviceName        string   `json:"deviceName,omitempty"`
	Agents            []string `json:"agents,omitempty"`
	WorkspaceCount    int      `json:"workspaceCount,omitempty"`
	Profile           string   `json:"profile,omitempty"`
	ServerURL         string   `json:"serverUrl,omitempty"`
	ExternallyManaged bool     `json:"externallyManaged,omitempty"`
}

type daemonPrefs struct {
	AutoStart bool `json:"autoStart"`
	AutoStop  bool `json:"autoStop"`
}

type localRuntimeProbe struct {
	ProbeResult     string         `json:"probeResult"`
	RuntimeCount    int            `json:"runtimeCount,omitempty"`
	ProviderSummary map[string]int `json:"providerSummary,omitempty"`
	OnlineCount     int            `json:"onlineCount,omitempty"`
	OfflineCount    int            `json:"offlineCount,omitempty"`
}

type daemonOperationResult struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

type daemonReauthResult struct {
	OK      bool   `json:"ok"`
	Reason  string `json:"reason,omitempty"`
	Message string `json:"message,omitempty"`
}

type healthPayload struct {
	Status     string   `json:"status"`
	PID        int      `json:"pid"`
	OS         string   `json:"os"`
	Uptime     string   `json:"uptime"`
	DaemonID   string   `json:"daemon_id"`
	DeviceName string   `json:"device_name"`
	ServerURL  string   `json:"server_url"`
	Agents     []string `json:"agents"`
	Workspaces []any    `json:"workspaces"`
}

type activeProfile struct {
	Name string
	Port int
}

type DaemonService struct {
	app *application.App

	mu           sync.Mutex
	targetAPIURL string
	currentState string
	active       *activeProfile
	operation    bool
	stopPolling  chan struct{}
	stopLogTail  chan struct{}
}

func newDaemonService() *DaemonService {
	return &DaemonService{currentState: "installing_cli"}
}

func (s *DaemonService) attach(app *application.App) {
	s.app = app
	s.stopPolling = make(chan struct{})
	go s.pollLoop()
}

func (s *DaemonService) SetTargetAPIURL(rawURL string) error {
	normalized, err := normalizeURL(rawURL, "http", "https")
	if err != nil {
		return errors.New("target API URL must use http or https")
	}
	s.mu.Lock()
	changed := s.targetAPIURL != normalized
	s.targetAPIURL = normalized
	if changed {
		s.active = nil
	}
	s.mu.Unlock()
	if changed {
		_, err = s.ensureActiveProfile()
	}
	return err
}

func (s *DaemonService) Start() daemonOperationResult {
	return s.withOperation(s.start)
}

func (s *DaemonService) Stop() daemonOperationResult {
	return s.withOperation(s.stop)
}

func (s *DaemonService) Restart() daemonOperationResult {
	return s.withOperation(func() daemonOperationResult {
		if result := s.stop(); !result.Success {
			return result
		}
		return s.start()
	})
}

func (s *DaemonService) GetStatus() daemonStatus {
	status := s.fetchStatus()
	s.emitStatus(status)
	return status
}

func (s *DaemonService) ProbeRuntimes() localRuntimeProbe {
	status := s.fetchStatus()
	if status.State == "running" {
		return runtimeProbe(status.Agents, true)
	}
	binary, err := resolveCLIBinary()
	if err != nil {
		return localRuntimeProbe{ProbeResult: "error"}
	}
	profile, err := s.ensureActiveProfile()
	if err != nil {
		return localRuntimeProbe{ProbeResult: "error"}
	}
	output, err := runCLI(15*time.Second, binary, append([]string{"daemon", "probe-runtimes"}, profileArgs(profile)...)...)
	if err != nil {
		return localRuntimeProbe{ProbeResult: "error"}
	}
	var response struct {
		ProbeResult     string         `json:"probe_result"`
		RuntimeCount    int            `json:"runtime_count"`
		ProviderSummary map[string]int `json:"provider_summary"`
	}
	if json.Unmarshal(output, &response) != nil || response.ProbeResult != "success" {
		return localRuntimeProbe{ProbeResult: "error"}
	}
	providers := make([]string, 0, response.RuntimeCount)
	for provider, count := range response.ProviderSummary {
		if count < 0 || count > 1000 {
			return localRuntimeProbe{ProbeResult: "error"}
		}
		for range count {
			providers = append(providers, provider)
		}
	}
	result := runtimeProbe(providers, false)
	if result.RuntimeCount != response.RuntimeCount {
		return localRuntimeProbe{ProbeResult: "error"}
	}
	return result
}

func (s *DaemonService) GetHostName() string {
	name, _ := os.Hostname()
	return name
}

func (s *DaemonService) SyncToken(token, userID string) error {
	if strings.TrimSpace(token) == "" || strings.TrimSpace(userID) == "" {
		return errors.New("token and user ID are required")
	}
	profile, err := s.ensureActiveProfile()
	if err != nil {
		return err
	}
	config, err := readJSONMap(profileConfigPath(profile.Name))
	if err != nil {
		return err
	}
	previousUserID, _ := os.ReadFile(profileUserIDPath(profile.Name))
	userChanged := strings.TrimSpace(string(previousUserID)) != "" &&
		strings.TrimSpace(string(previousUserID)) != userID
	cachedPAT, _ := config["token"].(string)

	finalToken := token
	if !strings.HasPrefix(token, "mul_") {
		if !userChanged && strings.TrimSpace(string(previousUserID)) == userID &&
			strings.HasPrefix(cachedPAT, "mul_") {
			finalToken = cachedPAT
		} else {
			finalToken, err = s.mintPAT(token)
			if err != nil {
				return err
			}
		}
	}
	config["token"] = finalToken
	s.mu.Lock()
	target := s.targetAPIURL
	s.mu.Unlock()
	if target != "" {
		config["server_url"] = target
	}
	if err := writeJSONMap(profileConfigPath(profile.Name), config); err != nil {
		return err
	}
	if err := os.WriteFile(profileUserIDPath(profile.Name), []byte(userID), 0o600); err != nil {
		return err
	}
	if userChanged {
		result := s.Restart()
		if !result.Success {
			return errors.New(result.Error)
		}
	}
	return nil
}

func (s *DaemonService) ClearToken() error {
	profile, err := s.ensureActiveProfile()
	if err != nil {
		return err
	}
	config, err := readJSONMap(profileConfigPath(profile.Name))
	if err != nil {
		return err
	}
	delete(config, "token")
	if err := writeJSONMap(profileConfigPath(profile.Name), config); err != nil {
		return err
	}
	if err := os.Remove(profileUserIDPath(profile.Name)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (s *DaemonService) Reauthenticate(token, userID string) daemonReauthResult {
	if err := s.ClearToken(); err != nil {
		return daemonReauthResult{Reason: "transient", Message: err.Error()}
	}
	if err := s.SyncToken(token, userID); err != nil {
		reason := "transient"
		if strings.Contains(err.Error(), "status 401") {
			reason = "session_invalid"
		}
		return daemonReauthResult{Reason: reason, Message: err.Error()}
	}
	result := s.Restart()
	if !result.Success {
		return daemonReauthResult{Reason: "transient", Message: result.Error}
	}
	return daemonReauthResult{OK: true}
}

func (s *DaemonService) IsCLIInstalled() bool {
	_, err := resolveCLIBinary()
	return err == nil
}

func (s *DaemonService) GetPrefs() daemonPrefs {
	prefs := daemonPrefs{AutoStart: true}
	raw, err := os.ReadFile(prefsPath())
	if err == nil {
		_ = json.Unmarshal(raw, &prefs)
	}
	return prefs
}

func (s *DaemonService) SetPrefs(update map[string]bool) (daemonPrefs, error) {
	prefs := s.GetPrefs()
	if value, ok := update["autoStart"]; ok {
		prefs.AutoStart = value
	}
	if value, ok := update["autoStop"]; ok {
		prefs.AutoStop = value
	}
	raw, err := json.MarshalIndent(prefs, "", "  ")
	if err != nil {
		return prefs, err
	}
	if err := os.MkdirAll(filepath.Dir(prefsPath()), 0o700); err != nil {
		return prefs, err
	}
	return prefs, os.WriteFile(prefsPath(), raw, 0o600)
}

func (s *DaemonService) AutoStart() {
	if !s.GetPrefs().AutoStart {
		return
	}
	status := s.fetchStatus()
	if status.State != "running" && status.State != "starting" {
		_ = s.Start()
	}
}

func (s *DaemonService) RetryInstall() {
	status := daemonStatus{State: "cli_not_found"}
	if s.IsCLIInstalled() {
		status = s.fetchStatus()
	}
	s.emitStatus(status)
}

func (s *DaemonService) StartLogStream() {
	s.mu.Lock()
	if s.stopLogTail != nil {
		s.mu.Unlock()
		return
	}
	stop := make(chan struct{})
	s.stopLogTail = stop
	s.mu.Unlock()
	go s.tailLog(stop)
}

func (s *DaemonService) StopLogStream() {
	s.mu.Lock()
	if s.stopLogTail != nil {
		close(s.stopLogTail)
		s.stopLogTail = nil
	}
	s.mu.Unlock()
}

func (s *DaemonService) OpenLogFile() daemonOperationResult {
	profile, err := s.ensureActiveProfile()
	if err != nil {
		return daemonOperationResult{Error: err.Error()}
	}
	path := profileLogPath(profile.Name)
	if _, err := os.Stat(path); err != nil {
		return daemonOperationResult{Error: "Log file not found yet"}
	}
	if err := s.app.Browser.OpenFile(path); err != nil {
		return daemonOperationResult{Error: err.Error()}
	}
	return daemonOperationResult{Success: true}
}

func (s *DaemonService) start() daemonOperationResult {
	binary, err := resolveCLIBinary()
	if err != nil {
		s.emitStatus(daemonStatus{State: "cli_not_found"})
		return daemonOperationResult{Error: err.Error()}
	}
	profile, err := s.ensureActiveProfile()
	if err != nil {
		return daemonOperationResult{Error: err.Error()}
	}
	if health := fetchHealth(profile.Port); health != nil &&
		(health.Status == "running" || health.Status == "starting") {
		return daemonOperationResult{Success: true}
	}
	s.emitStatus(daemonStatus{State: "starting", Profile: profile.Name})
	_, err = runCLI(60*time.Second, binary, append([]string{"daemon", "start"}, profileArgs(profile)...)...)
	if err != nil {
		s.emitStatus(daemonStatus{State: "stopped", Profile: profile.Name})
		return daemonOperationResult{Error: err.Error()}
	}
	s.emitStatus(s.fetchStatus())
	return daemonOperationResult{Success: true}
}

func (s *DaemonService) stop() daemonOperationResult {
	binary, err := resolveCLIBinary()
	if err != nil {
		return daemonOperationResult{Error: err.Error()}
	}
	profile, err := s.ensureActiveProfile()
	if err != nil {
		return daemonOperationResult{Error: err.Error()}
	}
	s.emitStatus(daemonStatus{State: "stopping", Profile: profile.Name})
	_, err = runCLI(15*time.Second, binary, append([]string{"daemon", "stop"}, profileArgs(profile)...)...)
	if err != nil {
		return daemonOperationResult{Error: err.Error()}
	}
	s.emitStatus(daemonStatus{State: "stopped", Profile: profile.Name})
	return daemonOperationResult{Success: true}
}

func (s *DaemonService) withOperation(operation func() daemonOperationResult) daemonOperationResult {
	s.mu.Lock()
	if s.operation {
		s.mu.Unlock()
		return daemonOperationResult{Error: "Another daemon operation is in progress"}
	}
	s.operation = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.operation = false
		s.mu.Unlock()
	}()
	return operation()
}

func (s *DaemonService) fetchStatus() daemonStatus {
	if _, err := resolveCLIBinary(); err != nil {
		return daemonStatus{State: "cli_not_found"}
	}
	profile, err := s.ensureActiveProfile()
	if err != nil {
		return daemonStatus{State: "stopped"}
	}
	health := fetchHealth(profile.Port)
	if health == nil {
		s.mu.Lock()
		state := s.currentState
		s.mu.Unlock()
		if state != "starting" && state != "stopping" {
			state = "stopped"
		}
		return daemonStatus{State: state, Profile: profile.Name}
	}
	if health.Status == "starting" {
		return daemonStatus{State: "starting", Profile: profile.Name}
	}
	if health.Status != "running" {
		return daemonStatus{State: "stopped", Profile: profile.Name}
	}
	s.mu.Lock()
	target := s.targetAPIURL
	s.mu.Unlock()
	if target != "" && health.ServerURL != "" && normalizedOrigin(target) != normalizedOrigin(health.ServerURL) {
		return daemonStatus{State: "stopped", Profile: profile.Name}
	}
	return daemonStatus{
		State:          "running",
		PID:            health.PID,
		Uptime:         health.Uptime,
		DaemonID:       health.DaemonID,
		DeviceName:     health.DeviceName,
		Agents:         health.Agents,
		WorkspaceCount: len(health.Workspaces),
		Profile:        profile.Name,
		ServerURL:      health.ServerURL,
	}
}

func (s *DaemonService) emitStatus(status daemonStatus) {
	s.mu.Lock()
	s.currentState = status.State
	s.mu.Unlock()
	if s.app != nil {
		s.app.Event.Emit("daemon:status", status)
	}
}

func (s *DaemonService) pollLoop() {
	ticker := time.NewTicker(daemonPollInterval)
	defer ticker.Stop()
	s.emitStatus(s.fetchStatus())
	for {
		select {
		case <-ticker.C:
			s.emitStatus(s.fetchStatus())
		case <-s.stopPolling:
			return
		}
	}
}

func (s *DaemonService) ensureActiveProfile() (activeProfile, error) {
	s.mu.Lock()
	if s.active != nil {
		profile := *s.active
		s.mu.Unlock()
		return profile, nil
	}
	target := s.targetAPIURL
	s.mu.Unlock()
	if target == "" {
		target = "https://api.multica.ai"
	}
	parsed, err := urlHost(target)
	if err != nil {
		return activeProfile{}, err
	}
	name := "desktop-" + strings.ReplaceAll(strings.ToLower(parsed), ":", "-")
	profile := activeProfile{Name: name, Port: healthPortForProfile(name)}
	config, err := readJSONMap(profileConfigPath(name))
	if err != nil {
		return activeProfile{}, err
	}
	if config["server_url"] != target {
		config["server_url"] = target
		if err := writeJSONMap(profileConfigPath(name), config); err != nil {
			return activeProfile{}, err
		}
	}
	s.mu.Lock()
	s.active = &profile
	s.mu.Unlock()
	return profile, nil
}

func (s *DaemonService) mintPAT(jwt string) (string, error) {
	s.mu.Lock()
	target := s.targetAPIURL
	s.mu.Unlock()
	if target == "" {
		target = "https://api.multica.ai"
	}
	body := bytes.NewBufferString(`{"name":"Multica Desktop"}`)
	request, err := http.NewRequest(http.MethodPost, strings.TrimRight(target, "/")+"/api/tokens", body)
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+jwt)
	client := &http.Client{Timeout: 15 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return "", fmt.Errorf("mint PAT failed: status %d %s", response.StatusCode, strings.TrimSpace(string(payload)))
	}
	var payload struct {
		Token string `json:"token"`
	}
	if json.NewDecoder(response.Body).Decode(&payload) != nil || !strings.HasPrefix(payload.Token, "mul_") {
		return "", errors.New("mint PAT: response missing token")
	}
	return payload.Token, nil
}

func (s *DaemonService) tailLog(stop <-chan struct{}) {
	profile, err := s.ensureActiveProfile()
	if err != nil {
		return
	}
	path := profileLogPath(profile.Name)
	var offset int64
	for {
		file, err := os.Open(path)
		if err == nil {
			info, statErr := file.Stat()
			if statErr == nil && info.Size() < offset {
				offset = 0
			}
			if offset == 0 && info != nil && info.Size() > 32*1024 {
				offset = info.Size() - 32*1024
			}
			_, _ = file.Seek(offset, io.SeekStart)
			scanner := bufio.NewScanner(file)
			for scanner.Scan() {
				s.app.Event.Emit("daemon:log-line", scanner.Text())
			}
			offset, _ = file.Seek(0, io.SeekCurrent)
			_ = file.Close()
		}
		select {
		case <-stop:
			return
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func runtimeProbe(providers []string, running bool) localRuntimeProbe {
	summary := make(map[string]int)
	for _, raw := range providers {
		provider := strings.ToLower(strings.TrimSpace(raw))
		if provider != "" {
			summary[provider]++
		}
	}
	count := 0
	for _, value := range summary {
		count += value
	}
	result := localRuntimeProbe{
		ProbeResult:     "success",
		RuntimeCount:    count,
		ProviderSummary: summary,
		OfflineCount:    count,
	}
	if running {
		result.OnlineCount = count
		result.OfflineCount = 0
	}
	return result
}

func fetchHealth(port int) *healthPayload {
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/health", port))
	if err != nil {
		return nil
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil
	}
	var payload healthPayload
	if json.NewDecoder(response.Body).Decode(&payload) != nil {
		return nil
	}
	return &payload
}

func resolveCLIBinary() (string, error) {
	executable, _ := os.Executable()
	name := "multica"
	if normalizedOS() == "windows" {
		name = "multica.exe"
	}
	candidates := []string{
		filepath.Join(filepath.Dir(executable), "resources", "bin", name),
		filepath.Join(filepath.Dir(executable), name),
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	if path, err := exec.LookPath(name); err == nil {
		return path, nil
	}
	return "", errors.New("multica CLI is not installed")
}

func runCLI(timeout time.Duration, binary string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, args...)
	command.Env = append(os.Environ(), "MULTICA_LAUNCHED_BY=desktop")
	output, err := command.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return output, fmt.Errorf("multica CLI timed out after %s", timeout)
	}
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return output, errors.New(message)
	}
	return output, nil
}

func profileArgs(profile activeProfile) []string {
	if profile.Name == "" {
		return nil
	}
	return []string{"--profile", profile.Name}
}

func healthPortForProfile(profile string) int {
	if profile == "" {
		return defaultHealthPort
	}
	sum := 0
	for _, value := range []byte(profile) {
		sum += int(value)
	}
	return defaultHealthPort + 1 + (sum % 1000)
}

func profileDirectory(profile string) string {
	home, _ := os.UserHomeDir()
	if profile == "" {
		return filepath.Join(home, ".multica")
	}
	return filepath.Join(home, ".multica", "profiles", profile)
}

func profileConfigPath(profile string) string {
	return filepath.Join(profileDirectory(profile), "config.json")
}

func profileLogPath(profile string) string {
	return filepath.Join(profileDirectory(profile), "daemon.log")
}

func profileUserIDPath(profile string) string {
	return filepath.Join(profileDirectory(profile), ".desktop-user-id")
}

func prefsPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".multica", "desktop_prefs.json")
}

func readJSONMap(path string) (map[string]any, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return make(map[string]any), nil
	}
	if err != nil {
		return nil, err
	}
	result := make(map[string]any)
	if len(raw) == 0 {
		return result, nil
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func writeJSONMap(path string, value map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".config-*.json")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.Write(raw); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, path)
}

func normalizedOrigin(rawURL string) string {
	origin, err := normalizeURL(rawURL, "http", "https")
	if err != nil {
		return ""
	}
	parts := strings.SplitN(origin, "/", 4)
	if len(parts) >= 3 {
		return strings.ToLower(parts[0] + "//" + parts[2])
	}
	return strings.ToLower(origin)
}

func urlHost(rawURL string) (string, error) {
	normalized := normalizedOrigin(rawURL)
	if normalized == "" {
		return "", errors.New("invalid API URL")
	}
	return strings.TrimPrefix(strings.TrimPrefix(normalized, "https://"), "http://"), nil
}

func sortedKeys(values map[string]int) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
