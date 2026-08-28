package linker

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"SkillsManager/internal/fsutil"
)

func EnsureSymlink(linkPath, target string) error {
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(linkPath), 0o755); err != nil {
		return err
	}
	if fi, err := os.Lstat(linkPath); err == nil {
		if fi.Mode()&os.ModeSymlink != 0 {
			if PointsTo(linkPath, absTarget) {
				return nil
			}
			if err := os.Remove(linkPath); err != nil {
				return err
			}
		} else {
			return fmt.Errorf("路径已存在且不是符号链接: %s", linkPath)
		}
	}
	return os.Symlink(absTarget, linkPath)
}

func RemoveSymlink(linkPath string) error {
	fi, err := os.Lstat(linkPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		return fmt.Errorf("不是符号链接，拒绝删除: %s", linkPath)
	}
	return os.Remove(linkPath)
}

// PointsTo reports whether linkPath is a symlink whose destination is the same
// location as target. Relative destinations are resolved against the link's
// parent directory, not the process CWD.
func PointsTo(linkPath, target string) bool {
	cur, err := os.Readlink(linkPath)
	if err != nil {
		return false
	}
	curAbs, err := absLinkDest(linkPath, cur)
	if err != nil {
		return false
	}
	wantAbs, err := absLinkDest(linkPath, target)
	if err != nil {
		return false
	}
	return fsutil.SamePath(curAbs, wantAbs)
}

func absLinkDest(linkPath, dest string) (string, error) {
	dest = strings.TrimSpace(dest)
	if dest == "" {
		return "", fmt.Errorf("empty link target")
	}
	if !filepath.IsAbs(dest) {
		dest = filepath.Join(filepath.Dir(linkPath), dest)
	}
	return filepath.Abs(dest)
}
