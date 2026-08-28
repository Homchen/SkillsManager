package main

import (
	"encoding/binary"
	"testing"
)

func TestApplicationHidesWindowOnClose(t *testing.T) {
	opts := NewApp().applicationOptions()
	if !opts.HideWindowOnClose {
		t.Fatal("close button should hide the window to the tray, not quit")
	}
}

func TestShowWindowNilContext(t *testing.T) {
	a := newAppCore()
	a.showWindow()
	a.quitApp()
	a.stopTray()
}

func TestTrayIconMatchesAppIcon(t *testing.T) {
	data := trayIconBytes()
	if len(data) < 22 {
		t.Fatalf("icon too small: %d", len(data))
	}
	if got := binary.LittleEndian.Uint16(data[0:2]); got != 0 {
		t.Fatalf("reserved = %d, want 0", got)
	}
	if got := binary.LittleEndian.Uint16(data[2:4]); got != 1 {
		t.Fatalf("type = %d, want 1 (ICO)", got)
	}
	count := binary.LittleEndian.Uint16(data[4:6])
	if count == 0 {
		t.Fatal("ICO must contain at least one image")
	}
	if len(appIcon) != len(data) {
		t.Fatal("tray icon must be the shared app icon")
	}
}
