package main

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
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
			Handler: application.AssetFileServerFS(distAssets),
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
		_, _ = fmt.Fprintf(os.Stderr, "Multica Wails failed to start: %v\n", err)
		os.Exit(1)
	}
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
