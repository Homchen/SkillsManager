//go:build windows

package reveal

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const coinitApartmentThreaded = 0x2

// Open shows path in Explorer and selects it, using the existing shell window.
// explorer.exe /select is avoided: it starts a new Explorer process that talks
// to the desktop via DDE/COM, which often delays the window by many seconds.
func Open(path string) error {
	if err := selectInExplorer(path); err == nil {
		return nil
	}
	return openParent(path)
}

func selectInExplorer(path string) error {
	pathp, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}

	ole32 := windows.NewLazySystemDLL("ole32.dll")
	shell32 := windows.NewLazySystemDLL("shell32.dll")
	procCoInitializeEx := ole32.NewProc("CoInitializeEx")
	procCoUninitialize := ole32.NewProc("CoUninitialize")
	procILCreateFromPathW := shell32.NewProc("ILCreateFromPathW")
	procILFree := shell32.NewProc("ILFree")
	procSHOpenFolderAndSelectItems := shell32.NewProc("SHOpenFolderAndSelectItems")

	hr, _, _ := procCoInitializeEx.Call(0, coinitApartmentThreaded)
	if hr == 0 {
		defer procCoUninitialize.Call()
	}

	pidl, _, _ := procILCreateFromPathW.Call(uintptr(unsafe.Pointer(pathp)))
	if pidl == 0 {
		return fmt.Errorf("无法定位文件")
	}
	defer procILFree.Call(pidl)

	hr, _, _ = procSHOpenFolderAndSelectItems.Call(pidl, 0, 0, 0)
	if hr != 0 {
		return fmt.Errorf("打开所在位置失败: 0x%x", hr)
	}
	return nil
}

func openParent(path string) error {
	cmd := exec.Command("explorer", filepath.Dir(path))
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.DETACHED_PROCESS}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("打开所在位置失败: %w", err)
	}
	_ = cmd.Process.Release()
	return nil
}
