package hubmigrate

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"SkillsManager/internal/fsutil"
	"SkillsManager/internal/linker"
)

var ensureSymlink = linker.EnsureSymlink

func NeedsContentMigrate(oldHub string) bool {
	oldHub = strings.TrimSpace(oldHub)
	if oldHub == "" {
		return false
	}
	needs, err := hubHasContent(oldHub)
	if err != nil {
		return false
	}
	return needs
}

// hubHasContent reports whether oldHub is a readable non-empty directory.
// Missing path → (false, nil). Unreadable / not-a-dir → error.
func hubHasContent(oldHub string) (bool, error) {
	st, err := os.Stat(oldHub)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	if !st.IsDir() {
		return false, fmt.Errorf("源仓路径不是目录: %s", oldHub)
	}
	entries, err := os.ReadDir(oldHub)
	if err != nil {
		return false, fmt.Errorf("读取源仓失败: %w", err)
	}
	return len(entries) > 0, nil
}

func Migrate(oldHub, newHub string, toolRoots []string) error {
	oldHub = cleanHub(oldHub)
	newHub = cleanHub(newHub)
	if oldHub == "" || newHub == "" {
		return fmt.Errorf("源仓路径为空")
	}
	if fsutil.SamePath(oldHub, newHub) {
		return nil
	}
	if isAncestorPath(oldHub, newHub) || isAncestorPath(newHub, oldHub) {
		return fmt.Errorf("新源仓路径不能位于旧源仓内部（或相反）")
	}
	needs, err := hubHasContent(oldHub)
	if err != nil {
		return err
	}
	if !needs {
		return os.MkdirAll(newHub, 0o755)
	}
	if err := ensureEmptyTarget(newHub); err != nil {
		return err
	}
	moved, err := moveChildren(oldHub, newHub)
	if err != nil {
		if rbErr := rollbackMove(newHub, oldHub, moved); rbErr != nil {
			return fmt.Errorf("%w；回滚失败（数据可能在 %s，配置请保持旧路径）: %v", err, newHub, rbErr)
		}
		return err
	}
	if err := rewriteToolSymlinks(oldHub, newHub, toolRoots); err != nil {
		if rbErr := rollbackMove(newHub, oldHub, moved); rbErr != nil {
			return fmt.Errorf("%w；回滚失败（数据可能在 %s，配置请保持旧路径）: %v", err, newHub, rbErr)
		}
		if linkErr := rewriteToolSymlinks(newHub, oldHub, toolRoots); linkErr != nil {
			return fmt.Errorf("%w；内容已回滚但链接恢复失败: %v", err, linkErr)
		}
		return err
	}
	return nil
}

func moveChildren(oldHub, newHub string) (moved []string, err error) {
	entries, err := os.ReadDir(oldHub)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		name := e.Name()
		src := filepath.Join(oldHub, name)
		dst := filepath.Join(newHub, name)
		if err := movePath(src, dst); err != nil {
			return moved, fmt.Errorf("迁移 %s 失败: %w", name, err)
		}
		moved = append(moved, name)
	}
	return moved, nil
}

func rollbackMove(fromHub, toHub string, names []string) error {
	var first error
	for i := len(names) - 1; i >= 0; i-- {
		name := names[i]
		src := filepath.Join(fromHub, name)
		dst := filepath.Join(toHub, name)
		if _, err := os.Lstat(src); err != nil {
			continue
		}
		if err := movePath(src, dst); err != nil && first == nil {
			first = err
		}
	}
	return first
}

func movePath(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	if err := fsutil.CopyTree(src, dst); err != nil {
		_ = os.RemoveAll(dst)
		return err
	}
	return os.RemoveAll(src)
}

func rewriteToolSymlinks(oldHub, newHub string, toolRoots []string) error {
	oldAbs, err := filepath.Abs(oldHub)
	if err != nil {
		return err
	}
	newAbs, err := filepath.Abs(newHub)
	if err != nil {
		return err
	}
	for _, root := range toolRoots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		if _, err := os.Stat(root); err != nil {
			continue
		}
		err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.Type()&os.ModeSymlink == 0 {
				return nil
			}
			cur, err := os.Readlink(path)
			if err != nil {
				return nil
			}
			curAbs := cur
			if !filepath.IsAbs(curAbs) {
				curAbs = filepath.Join(filepath.Dir(path), cur)
			}
			curAbs, err = filepath.Abs(curAbs)
			if err != nil {
				return nil
			}
			rel, err := filepath.Rel(oldAbs, curAbs)
			if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				return nil
			}
			newTarget := filepath.Join(newAbs, rel)
			if err := ensureSymlink(path, newTarget); err != nil {
				return fmt.Errorf("改写链接失败 %s: %w", path, err)
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func cleanHub(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	return filepath.Clean(p)
}

func isAncestorPath(ancestor, child string) bool {
	absA, err := filepath.Abs(ancestor)
	if err != nil {
		return false
	}
	absC, err := filepath.Abs(child)
	if err != nil {
		return false
	}
	absA = filepath.Clean(absA)
	absC = filepath.Clean(absC)
	if fsutil.SamePath(absA, absC) {
		return false
	}
	rel, err := filepath.Rel(absA, absC)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func ensureEmptyTarget(newHub string) error {
	st, err := os.Stat(newHub)
	if err != nil {
		if os.IsNotExist(err) {
			return os.MkdirAll(newHub, 0o755)
		}
		return err
	}
	if !st.IsDir() {
		return fmt.Errorf("目标源仓路径不是目录: %s", newHub)
	}
	entries, err := os.ReadDir(newHub)
	if err != nil {
		return err
	}
	if len(entries) > 0 {
		return fmt.Errorf("目标源仓目录非空，拒绝迁移: %s", newHub)
	}
	return nil
}
