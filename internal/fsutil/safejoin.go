package fsutil

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// SafeJoinUnder joins root/rel and rejects ".." segments as well as any
// symlink (or Windows reparse point exposed as ModeSymlink) on the path.
// Missing trailing segments are allowed so callers can create new files.
func SafeJoinUnder(root, rel string) (string, error) {
	rel = filepath.ToSlash(strings.TrimSpace(rel))
	rel = strings.Trim(rel, "/")
	if rel == "" {
		return "", fmt.Errorf("路径不能为空")
	}
	parts := strings.Split(rel, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return "", fmt.Errorf("路径越界: %s", rel)
		}
	}

	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	absRoot = filepath.Clean(absRoot)

	cur := absRoot
	for i, part := range parts {
		next := filepath.Join(cur, part)
		fi, err := os.Lstat(next)
		if err != nil {
			if !os.IsNotExist(err) {
				return "", err
			}
			joined := filepath.Join(append([]string{cur}, parts[i:]...)...)
			return ensureUnderRoot(absRoot, joined, rel)
		}
		if fi.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("路径越界: %s", rel)
		}
		cur = next
	}
	return ensureUnderRoot(absRoot, cur, rel)
}

func ensureUnderRoot(root, abs, rel string) (string, error) {
	abs, err := filepath.Abs(abs)
	if err != nil {
		return "", err
	}
	abs = filepath.Clean(abs)
	root = filepath.Clean(root)
	if pathWithin(root, abs) {
		return abs, nil
	}
	return "", fmt.Errorf("路径越界: %s", rel)
}

func pathWithin(root, abs string) bool {
	if runtime.GOOS == "windows" {
		root = strings.ToLower(root)
		abs = strings.ToLower(abs)
	}
	if abs == root {
		return true
	}
	sep := string(os.PathSeparator)
	return strings.HasPrefix(abs, root+sep)
}

// SplitSkillID validates and splits a skill id into path segments.
// Nested ids such as "parent/examples/child" are allowed; ".." is rejected.
func SplitSkillID(skillID string) ([]string, error) {
	id := NormalizeSkillID(skillID)
	if id == "" {
		return nil, fmt.Errorf("skill id 不能为空")
	}
	parts := strings.Split(id, "/")
	for _, p := range parts {
		if p == "" || p == "." || p == ".." || strings.Contains(p, "..") {
			return nil, fmt.Errorf("skill id 非法: %s", skillID)
		}
		if ShouldSkipDir(p) {
			return nil, fmt.Errorf("skill id 保留名不可用: %s", skillID)
		}
	}
	return parts, nil
}

// FindHubSkillDir locates hubRoot/<group>/<leaf> the same way skillrepo.Find does.
// Residual nested RelSkillIDs such as "parent/child" look up the leaf id so
// organize/merge share one hub identity with CRUD. Traversal segments are still rejected.
func FindHubSkillDir(hubRoot, skillID string) (string, bool) {
	id := NormalizeSkillID(skillID)
	if id == "" || hubRoot == "" {
		return "", false
	}
	if _, err := SplitSkillID(id); err != nil {
		return "", false
	}
	if i := strings.LastIndex(id, "/"); i >= 0 {
		id = id[i+1:]
	}
	ents, err := os.ReadDir(hubRoot)
	if err != nil {
		return "", false
	}
	for _, e := range ents {
		if !e.IsDir() || ShouldSkipDir(e.Name()) {
			continue
		}
		cand := filepath.Join(hubRoot, e.Name(), id)
		if IsSkillDir(cand) {
			return cand, true
		}
	}
	return "", false
}
