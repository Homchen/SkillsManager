package main

import (
	goruntime "runtime"

	"github.com/energye/systray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *appCore) startTray() {
	if !a.trayStarted.CompareAndSwap(false, true) {
		return
	}
	go func() {
		goruntime.LockOSThread()
		systray.Run(a.onTrayReady, nil)
	}()
}

func (a *appCore) stopTray() {
	if a.trayStarted.Load() {
		systray.Quit()
	}
}

func (a *appCore) onTrayReady() {
	systray.SetIcon(trayIconBytes())
	systray.SetTitle("SkillsManager")
	systray.SetTooltip("SkillsManager")
	systray.SetOnClick(func(_ systray.IMenu) {
		go a.showWindow()
	})
	systray.SetOnDClick(func(_ systray.IMenu) {
		go a.showWindow()
	})

	mShow := systray.AddMenuItem("显示窗口", "显示主窗口")
	mShow.Click(func() {
		go a.showWindow()
	})
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("退出", "退出 SkillsManager")
	mQuit.Click(func() {
		// Quit on another goroutine so the tray loop can process WM_QUIT
		// from OnShutdown without deadlocking the click handler.
		go a.quitApp()
	})
}

func (a *appCore) showWindow() {
	if a.ctx == nil {
		return
	}
	runtime.WindowUnminimise(a.ctx)
	runtime.WindowShow(a.ctx)
}

func (a *appCore) quitApp() {
	if a.ctx == nil {
		return
	}
	runtime.Quit(a.ctx)
}
