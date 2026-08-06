package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/dock"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// Embed the frontend tree rather than only dist so `go test` still compiles
// before the first frontend build. Production builds require dist below.
//
//go:embed all:frontend
var assets embed.FS

var version = "0.1.0"

func main() {
	distAssets, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "Multica Wails frontend is missing; run pnpm build:frontend: %v\n", err)
		os.Exit(1)
	}
	dockService := dock.New()
	var notificationService *notifications.NotificationService
	if notificationsSupportedAtStartup() {
		notificationService = notifications.New()
	}
	appService := newAppService(dockService, notificationService)
	daemonService := newDaemonService()
	replicaService := newReplicaService()
	services := []application.Service{
		application.NewService(appService),
		application.NewService(daemonService),
		application.NewService(replicaService),
		application.NewService(dockService),
	}
	if notificationService != nil {
		services = append(services, application.NewService(notificationService))
	}

	app := application.New(application.Options{
		Name:        "Multica",
		Description: "Multica desktop client hosted by Go and Wails v3",
		Services:    services,
		Assets: application.AssetOptions{
			Handler: newSPAAssetHandler(distAssets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	appService.attach(app)
	daemonService.attach(app)
	app.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl, func(event *application.ApplicationEvent) {
		appService.handleDeepLink(event.Context().URL())
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      mainWindowName,
		Title:     "Multica",
		Width:     1440,
		Height:    920,
		MinWidth:  980,
		MinHeight: 680,
		URL:       "/",
		Mac: application.MacWindow{
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
			InvisibleTitleBarHeight: 48,
		},
	})

	if err := app.Run(); err != nil {
		logWailsRunError(application.DefaultLogger(slog.LevelError), err)
		os.Exit(1)
	}
}

func logWailsRunError(logger *slog.Logger, err error) {
	logger.Error(
		"wails run failed",
		"error_type", fmt.Sprintf("%T", err),
		"error_text", err.Error(),
	)
}

func newSPAAssetHandler(distAssets fs.FS) http.Handler {
	assets := application.AssetFileServerFS(distAssets)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isSPADocumentRequest(r) {
			clone := r.Clone(r.Context())
			clonedURL := *r.URL
			clonedURL.Path = "/"
			clonedURL.RawPath = ""
			clone.URL = &clonedURL
			assets.ServeHTTP(w, clone)
			return
		}
		assets.ServeHTTP(w, r)
	})
}

func isSPADocumentRequest(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	cleanPath := path.Clean(r.URL.Path)
	if cleanPath == "." || cleanPath == "/" || strings.HasPrefix(cleanPath, "/wails/") {
		return false
	}
	if path.Ext(cleanPath) != "" {
		return false
	}
	return r.Header.Get("Sec-Fetch-Dest") == "document" ||
		strings.Contains(r.Header.Get("Accept"), "text/html")
}

func notificationsSupportedAtStartup() bool {
	if runtime.GOOS != "darwin" {
		return true
	}
	executable, err := os.Executable()
	if err != nil {
		return false
	}
	normalized := filepath.ToSlash(filepath.Clean(executable))
	return strings.Contains(normalized, ".app/Contents/MacOS/")
}
