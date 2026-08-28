package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Process starts unelevated. Users can request admin via Settings → 以管理员身份重启
	// when symlink / organize operations need SeCreateSymbolicLinkPrivilege.

	app := NewApp()

	err := wails.Run(app.applicationOptions())

	if err != nil {
		println("Error:", err.Error())
	}
}

func (a *App) applicationOptions() *options.App {
	return &options.App{
		Title:  "SkillsManager",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		// Close button hides to the tray; tray menu "退出" calls runtime.Quit.
		HideWindowOnClose: true,
		OnStartup:         a.startup,
		OnShutdown:        a.shutdown,
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},
		Bind: []interface{}{
			a,
		},
	}
}
