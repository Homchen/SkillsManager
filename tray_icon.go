package main

import _ "embed"

// Canonical artwork is build/appicon.png (Wails window / macOS / Linux).
// build/windows/icon.ico is the same mark, used for the exe, installer, and tray.
//
//go:embed build/windows/icon.ico
var appIcon []byte

func trayIconBytes() []byte {
	return appIcon
}
