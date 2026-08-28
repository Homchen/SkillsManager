//go:build !windows

package reveal

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Open shows path in the system file manager and selects it when supported.
func Open(path string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	default:
		cmd = exec.Command("xdg-open", filepath.Dir(path))
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("打开所在位置失败: %w", err)
	}
	_ = cmd.Process.Release()
	return nil
}
