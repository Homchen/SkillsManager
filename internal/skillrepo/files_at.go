package skillrepo

import (
	"fmt"
	"os"
	"path/filepath"

	"SkillsManager/internal/fsutil"
)

// ListFilesIn lists relative file paths under an absolute skill root.
func ListFilesIn(root string) ([]string, error) {
	var out []string
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if path != root && fsutil.ShouldSkipDir(d.Name()) {
				return filepath.SkipDir
			}
			if path == root {
				return nil
			}
			ents, readErr := os.ReadDir(path)
			if readErr != nil {
				return readErr
			}
			if len(ents) == 0 {
				rel, relErr := filepath.Rel(root, path)
				if relErr != nil {
					return relErr
				}
				out = append(out, filepath.ToSlash(rel)+"/")
			}
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		out = append(out, filepath.ToSlash(rel))
		return nil
	})
	return out, err
}

func resolveUnderRoot(root, rel string) (string, error) {
	rel, err := normalizeRelPath(rel)
	if err != nil {
		return "", err
	}
	return fsutil.SafeJoinUnder(root, rel)
}

// ReadFileIn reads a text file under an absolute skill root.
func ReadFileIn(root, rel string) (string, error) {
	abs, err := resolveUnderRoot(root, rel)
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// WriteFileIn writes a text file under an absolute skill root.
func WriteFileIn(root, rel, content string) error {
	abs, err := resolveUnderRoot(root, rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	return os.WriteFile(abs, []byte(content), 0o644)
}

// CreateFileIn creates an empty text file under an absolute skill root.
func CreateFileIn(root, rel string) error {
	abs, err := resolveUnderRoot(root, rel)
	if err != nil {
		return err
	}
	if _, err := os.Stat(abs); err == nil {
		return fmt.Errorf("已存在: %s", rel)
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(abs, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	return f.Close()
}

// MkdirIn creates a directory under an absolute skill root.
func MkdirIn(root, rel string) error {
	abs, err := resolveUnderRoot(root, rel)
	if err != nil {
		return err
	}
	if st, err := os.Stat(abs); err == nil {
		if st.IsDir() {
			return fmt.Errorf("目录已存在: %s", rel)
		}
		return fmt.Errorf("已存在同名文件: %s", rel)
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.MkdirAll(abs, 0o755)
}

// RenameEntryIn renames a file or directory under an absolute skill root.
func RenameEntryIn(root, oldRel, newRel string) error {
	oldRel, err := normalizeRelPath(oldRel)
	if err != nil {
		return err
	}
	newRel, err = normalizeRelPath(newRel)
	if err != nil {
		return err
	}
	if isRootSkillDefinition(oldRel) {
		return fmt.Errorf("不能重命名技能根目录的 SKILL.md")
	}
	if oldRel == newRel {
		return nil
	}
	src, err := fsutil.SafeJoinUnder(root, oldRel)
	if err != nil {
		return err
	}
	if _, err := os.Stat(src); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("未找到: %s", oldRel)
		}
		return err
	}
	dst, err := fsutil.SafeJoinUnder(root, newRel)
	if err != nil {
		return err
	}
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("已存在: %s", newRel)
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.Rename(src, dst)
}

// DeleteEntryIn permanently removes a file or directory under an absolute skill root.
func DeleteEntryIn(root, rel string) error {
	rel, err := normalizeRelPath(rel)
	if err != nil {
		return err
	}
	if isRootSkillDefinition(rel) {
		return fmt.Errorf("不能删除技能根目录的 SKILL.md")
	}
	abs, err := fsutil.SafeJoinUnder(root, rel)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(abs); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("未找到: %s", rel)
		}
		return err
	}
	return os.RemoveAll(abs)
}
