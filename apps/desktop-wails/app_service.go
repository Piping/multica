package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/dock"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

const mainWindowName = "main"

type runtimeConfig struct {
	SchemaVersion int    `json:"schemaVersion"`
	APIURL        string `json:"apiUrl"`
	WSURL         string `json:"wsUrl"`
	AppURL        string `json:"appUrl"`
}

type runtimeConfigError struct {
	Message string `json:"message"`
}

type runtimeConfigResult struct {
	OK     bool                `json:"ok"`
	Config *runtimeConfig      `json:"config,omitempty"`
	Error  *runtimeConfigError `json:"error,omitempty"`
}

type appInfo struct {
	Version string `json:"version"`
	OS      string `json:"os"`
}

type windowContext struct {
	Kind          string `json:"kind"`
	Path          string `json:"path,omitempty"`
	Title         string `json:"title,omitempty"`
	WorkspaceSlug string `json:"workspaceSlug,omitempty"`
	IssueID       string `json:"issueId,omitempty"`
}

type bootstrapResult struct {
	AppInfo       appInfo             `json:"appInfo"`
	SystemLocale  string              `json:"systemLocale"`
	RuntimeConfig runtimeConfigResult `json:"runtimeConfig"`
	WindowContext windowContext       `json:"windowContext"`
}

type issueWindowRequest struct {
	Path  string `json:"path"`
	Title string `json:"title"`
}

type operationResult struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason,omitempty"`
}

type pickDirectoryResult struct {
	OK       bool   `json:"ok"`
	Path     string `json:"path,omitempty"`
	Basename string `json:"basename,omitempty"`
	Reason   string `json:"reason,omitempty"`
	Error    string `json:"error,omitempty"`
}

type validateDirectoryResult struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason,omitempty"`
	Error  string `json:"error,omitempty"`
}

type notificationPayload struct {
	Slug     string `json:"slug"`
	ItemID   string `json:"itemId"`
	IssueKey string `json:"issueKey"`
	Title    string `json:"title"`
	Body     string `json:"body"`
}

type AppService struct {
	app           *application.App
	dock          *dock.DockService
	notifications *notifications.NotificationService

	mu             sync.Mutex
	windowContexts map[string]windowContext
}

func newAppService(
	dockService *dock.DockService,
	notificationService *notifications.NotificationService,
) *AppService {
	return &AppService{
		dock:          dockService,
		notifications: notificationService,
		windowContexts: map[string]windowContext{
			mainWindowName: {Kind: "main"},
		},
	}
}

func (s *AppService) attach(app *application.App) {
	s.app = app
}

func (s *AppService) Bootstrap(windowName string) bootstrapResult {
	context := windowContext{Kind: "main"}
	s.mu.Lock()
	if saved, ok := s.windowContexts[windowName]; ok {
		context = saved
	}
	s.mu.Unlock()

	return bootstrapResult{
		AppInfo: appInfo{
			Version: version,
			OS:      normalizedOS(),
		},
		SystemLocale:  systemLocale(),
		RuntimeConfig: loadRuntimeConfig(),
		WindowContext: context,
	}
}

func (s *AppService) ReportStartupError(message string) {
	_, _ = fmt.Fprintf(os.Stderr, "Multica Wails renderer startup failed: %s\n", message)
}

func (s *AppService) OpenExternal(rawURL string) error {
	parsed, err := url.ParseRequestURI(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return errors.New("only http and https URLs can be opened")
	}
	return s.app.Browser.OpenURL(parsed.String())
}

func (s *AppService) DownloadURL(rawURL string) error {
	return s.OpenExternal(rawURL)
}

func (s *AppService) SetImmersiveMode(_ bool) {}

func (s *AppService) ShowNotification(payload notificationPayload) error {
	if strings.TrimSpace(payload.Title) == "" {
		return errors.New("notification title is required")
	}
	if s.notifications == nil {
		return nil
	}
	return s.notifications.SendNotification(notifications.NotificationOptions{
		ID:    payload.ItemID,
		Title: payload.Title,
		Body:  payload.Body,
		Data: map[string]interface{}{
			"slug":     payload.Slug,
			"itemId":   payload.ItemID,
			"issueKey": payload.IssueKey,
		},
	})
}

func (s *AppService) SetUnreadBadge(count int) error {
	if count <= 0 {
		return s.dock.RemoveBadge()
	}
	return s.dock.SetBadge(strconv.Itoa(count))
}

func (s *AppService) PickDirectory(defaultPath string) pickDirectoryResult {
	dialog := s.app.Dialog.OpenFile().
		CanChooseDirectories(true).
		CanChooseFiles(false).
		SetTitle("Select local directory")
	if filepath.IsAbs(defaultPath) {
		dialog.SetDirectory(defaultPath)
	}
	selected, err := dialog.PromptForSingleSelection()
	if err != nil {
		return pickDirectoryResult{Reason: "error", Error: err.Error()}
	}
	if selected == "" {
		return pickDirectoryResult{Reason: "cancelled"}
	}
	return pickDirectoryResult{
		OK:       true,
		Path:     selected,
		Basename: filepath.Base(selected),
	}
}

func (s *AppService) ValidateLocalDirectory(path string) validateDirectoryResult {
	if !filepath.IsAbs(path) {
		return validateDirectoryResult{Reason: "not_absolute"}
	}
	info, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return validateDirectoryResult{Reason: "not_found"}
		}
		return validateDirectoryResult{Reason: "error", Error: err.Error()}
	}
	if !info.IsDir() {
		return validateDirectoryResult{Reason: "not_a_directory"}
	}
	if err := testDirectoryAccess(path, os.O_RDONLY); err != nil {
		return validateDirectoryResult{Reason: "not_readable"}
	}
	if err := testDirectoryWrite(path); err != nil {
		return validateDirectoryResult{Reason: "not_writable"}
	}
	return validateDirectoryResult{OK: true}
}

func (s *AppService) OpenIssueWindow(request issueWindowRequest) operationResult {
	context, ok := parseIssueWindowRequest(request)
	if !ok {
		return operationResult{Reason: "invalid_request"}
	}
	name := "issue-" + context.WorkspaceSlug + "-" + context.IssueID
	s.mu.Lock()
	s.windowContexts[name] = context
	s.mu.Unlock()

	if existing, exists := s.app.Window.GetByName(name); exists {
		existing.Show()
		existing.Focus()
		return operationResult{OK: true}
	}
	s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      name,
		Title:     context.Title,
		Width:     1120,
		Height:    820,
		MinWidth:  760,
		MinHeight: 560,
		URL:       "/?wailsWindow=" + url.QueryEscape(name),
		Mac: application.MacWindow{
			Backdrop: application.MacBackdropTranslucent,
			TitleBar: application.MacTitleBarDefault,
		},
	})
	return operationResult{OK: true}
}

func (s *AppService) CloseWindow(windowName string) {
	if window, ok := s.app.Window.GetByName(windowName); ok {
		window.Close()
	}
}

func (s *AppService) OpenLogFile(path string) error {
	return s.app.Browser.OpenFile(path)
}

func (s *AppService) handleDeepLink(rawURL string) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "multica" {
		return
	}
	switch {
	case parsed.Host == "auth" && strings.Trim(parsed.Path, "/") == "callback":
		if token := parsed.Query().Get("token"); token != "" {
			s.app.Event.Emit("auth:token", token)
		}
	case parsed.Host == "invite":
		invitationID := strings.Trim(parsed.Path, "/")
		if invitationID != "" {
			s.app.Event.Emit("invite:open", invitationID)
		}
	}
	if window, ok := s.app.Window.GetByName(mainWindowName); ok {
		window.Show()
		window.Focus()
	}
}

func testDirectoryAccess(path string, flag int) error {
	file, err := os.OpenFile(path, flag, 0)
	if err != nil {
		return err
	}
	return file.Close()
}

func testDirectoryWrite(path string) error {
	file, err := os.CreateTemp(path, ".multica-write-check-*")
	if err != nil {
		return err
	}
	name := file.Name()
	if closeErr := file.Close(); closeErr != nil {
		_ = os.Remove(name)
		return closeErr
	}
	return os.Remove(name)
}

func parseIssueWindowRequest(request issueWindowRequest) (windowContext, bool) {
	if len(request.Path) == 0 || len(request.Path) > 2048 || !strings.HasPrefix(request.Path, "/") {
		return windowContext{}, false
	}
	parsed, err := url.ParseRequestURI(request.Path)
	if err != nil {
		return windowContext{}, false
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) != 3 || parts[1] != "issues" || !validSlug(parts[0]) || !validIssueRef(parts[2]) {
		return windowContext{}, false
	}
	title := strings.TrimSpace(request.Title)
	if title == "" {
		title = "Issue"
	}
	if len(title) > 256 {
		title = title[:256]
	}
	return windowContext{
		Kind:          "issue",
		Path:          request.Path,
		Title:         title,
		WorkspaceSlug: parts[0],
		IssueID:       parts[2],
	}, true
}

func validSlug(value string) bool {
	if len(value) == 0 || len(value) > 63 {
		return false
	}
	for index, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') {
			continue
		}
		if character != '-' || index == 0 {
			return false
		}
	}
	return true
}

func validIssueRef(value string) bool {
	if len(value) == 0 || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			character == '_' || character == '-' {
			continue
		}
		return false
	}
	return true
}

func loadRuntimeConfig() runtimeConfigResult {
	config := runtimeConfig{
		SchemaVersion: 1,
		APIURL:        "https://api.multica.ai",
		WSURL:         "wss://api.multica.ai/ws",
		AppURL:        "https://multica.ai",
	}
	if os.Getenv("WAILS_VITE_PORT") != "" || os.Getenv("MULTICA_DESKTOP_DEV") == "1" {
		config.APIURL = envOrDefault("VITE_API_URL", "http://localhost:8080")
		config.WSURL = envOrDefault("VITE_WS_URL", deriveWSURL(config.APIURL))
		config.AppURL = envOrDefault("VITE_APP_URL", deriveAppURL(config.APIURL, true))
		return validateRuntimeConfig(config)
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return runtimeConfigFailure(err.Error())
	}
	path := filepath.Join(home, ".multica", "desktop.json")
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return runtimeConfigResult{OK: true, Config: &config}
	}
	if err != nil {
		return runtimeConfigFailure(fmt.Sprintf("Invalid %s: %v", path, err))
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		return runtimeConfigFailure(fmt.Sprintf("Invalid %s: %v", path, err))
	}
	return validateRuntimeConfig(config)
}

func validateRuntimeConfig(config runtimeConfig) runtimeConfigResult {
	if config.SchemaVersion != 1 {
		return runtimeConfigFailure("Unsupported desktop runtime config schemaVersion: expected 1")
	}
	apiURL, err := normalizeURL(config.APIURL, "http", "https")
	if err != nil {
		return runtimeConfigFailure("Invalid desktop runtime config: apiUrl must use http or https")
	}
	config.APIURL = apiURL
	if config.WSURL == "" {
		config.WSURL = deriveWSURL(apiURL)
	}
	wsURL, err := normalizeURL(config.WSURL, "ws", "wss")
	if err != nil {
		return runtimeConfigFailure("Invalid desktop runtime config: wsUrl must use ws or wss")
	}
	config.WSURL = wsURL
	if config.AppURL == "" {
		config.AppURL = deriveAppURL(apiURL, false)
	}
	appURL, err := normalizeURL(config.AppURL, "http", "https")
	if err != nil {
		return runtimeConfigFailure("Invalid desktop runtime config: appUrl must use http or https")
	}
	config.AppURL = appURL
	return runtimeConfigResult{OK: true, Config: &config}
}

func runtimeConfigFailure(message string) runtimeConfigResult {
	return runtimeConfigResult{Error: &runtimeConfigError{Message: message}}
}

func normalizeURL(raw string, schemes ...string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return "", errors.New("invalid URL")
	}
	validScheme := false
	for _, scheme := range schemes {
		if parsed.Scheme == scheme {
			validScheme = true
		}
	}
	if !validScheme {
		return "", errors.New("invalid scheme")
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

func deriveWSURL(apiURL string) string {
	parsed, err := url.Parse(apiURL)
	if err != nil {
		return ""
	}
	if parsed.Scheme == "https" {
		parsed.Scheme = "wss"
	} else {
		parsed.Scheme = "ws"
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/ws"
	return strings.TrimRight(parsed.String(), "/")
}

func deriveAppURL(apiURL string, dev bool) string {
	parsed, err := url.Parse(apiURL)
	if err != nil {
		return ""
	}
	if dev && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1") {
		return "http://localhost:3000"
	}
	parsed.Path, parsed.RawQuery, parsed.Fragment = "", "", ""
	if strings.HasPrefix(parsed.Hostname(), "api.") && len(strings.Split(parsed.Hostname(), ".")) >= 3 {
		hostname := strings.TrimPrefix(parsed.Hostname(), "api.")
		parsed.Host = hostname
		if port := parsed.Port(); port != "" {
			parsed.Host += ":" + port
		}
	}
	return strings.TrimRight(parsed.String(), "/")
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func normalizedOS() string {
	switch runtime.GOOS {
	case "darwin":
		return "macos"
	case "windows", "linux":
		return runtime.GOOS
	default:
		return "unknown"
	}
}

func systemLocale() string {
	for _, name := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		value := strings.TrimSpace(os.Getenv(name))
		if value == "" {
			continue
		}
		value = strings.Split(value, ".")[0]
		value = strings.ReplaceAll(value, "_", "-")
		if value != "C" && value != "POSIX" {
			return value
		}
	}
	return "en-US"
}
