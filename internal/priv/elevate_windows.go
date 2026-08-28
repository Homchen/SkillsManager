//go:build windows

package priv

import (
	"errors"
	"os"
	"syscall"

	"golang.org/x/sys/windows"
)

// EnsureElevated is intentionally a no-op: the GUI runs unelevated by default.
// Symlink / organize operations call RequestElevation on demand.
func EnsureElevated() {}

// RequestElevation relaunches the current executable with UAC elevation.
// On success this process exits 0 after spawning the elevated instance.
// If already elevated, it returns nil without restarting.
func RequestElevation() error {
	if IsElevated() {
		return nil
	}
	if containsArg(os.Args[1:], ElevatingArg) {
		return errors.New("提权失败：用户取消了 UAC，或以管理员身份启动失败")
	}
	if err := relaunchElevated(); err != nil {
		return err
	}
	os.Exit(0)
	return nil
}

func containsArg(args []string, want string) bool {
	for _, a := range args {
		if a == want {
			return true
		}
	}
	return false
}

func relaunchElevated() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cwd, err := os.Getwd()
	if err != nil {
		cwd = ""
	}

	rest := filterOutArg(os.Args[1:], ElevatingArg)
	params := quoteArgs(append([]string{ElevatingArg}, rest...))

	verbPtr, err := syscall.UTF16PtrFromString("runas")
	if err != nil {
		return err
	}
	exePtr, err := syscall.UTF16PtrFromString(exe)
	if err != nil {
		return err
	}
	cwdPtr, err := syscall.UTF16PtrFromString(cwd)
	if err != nil {
		return err
	}
	argPtr, err := syscall.UTF16PtrFromString(params)
	if err != nil {
		return err
	}

	const swNormal = 1
	return windows.ShellExecute(0, verbPtr, exePtr, argPtr, cwdPtr, swNormal)
}

func filterOutArg(args []string, drop string) []string {
	out := make([]string, 0, len(args))
	for _, a := range args {
		if a != drop {
			out = append(out, a)
		}
	}
	return out
}
