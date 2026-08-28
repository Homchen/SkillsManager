package trash

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"SkillsManager/internal/domain"
)

var ErrTargetExists = errors.New("目标已存在")

type Store struct {
	Hub string
}

func New(hub string) *Store { return &Store{Hub: hub} }

func (s *Store) root() string { return filepath.Join(s.Hub, "_trash") }

func (s *Store) Move(src string) (string, error) {
	ts := time.Now().Format("20060102-150405")
	bucket := filepath.Join(s.root(), ts)

	relID := filepath.Base(src)
	if absSrc, err := filepath.Abs(src); err == nil {
		if absHub, err2 := filepath.Abs(s.Hub); err2 == nil {
			absSrc = filepath.Clean(absSrc)
			absHub = filepath.Clean(absHub)
			sep := string(os.PathSeparator)
			if absSrc == absHub || strings.HasPrefix(strings.ToLower(absSrc), strings.ToLower(absHub+sep)) {
				if r, err3 := filepath.Rel(absHub, absSrc); err3 == nil && r != "." && !strings.HasPrefix(r, "..") {
					relID = filepath.ToSlash(r)
				}
			}
		}
	}

	dest := filepath.Join(append([]string{bucket}, strings.Split(relID, "/")...)...)
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return "", err
	}
	if _, err := os.Stat(dest); err == nil {
		leaf := filepath.Base(dest) + fmt.Sprintf("-%d", time.Now().UnixNano())
		dest = filepath.Join(filepath.Dir(dest), leaf)
	}
	if err := os.Rename(src, dest); err != nil {
		return "", err
	}
	return dest, nil
}

func (s *Store) validateTrashPath(trashPath string) (string, error) {
	abs, err := filepath.Abs(trashPath)
	if err != nil {
		return "", err
	}
	abs = filepath.Clean(abs)
	root, err := filepath.Abs(s.root())
	if err != nil {
		return "", err
	}
	root = filepath.Clean(root)
	sep := string(os.PathSeparator)
	af, rf := strings.ToLower(abs), strings.ToLower(root)
	// 必须严格位于 _trash 之下，不能等于 trash root 本身
	if af == rf || !strings.HasPrefix(af, rf+sep) {
		return "", fmt.Errorf("路径不在回收站内")
	}
	return abs, nil
}

func (s *Store) List(retentionDays int) ([]domain.TrashItem, error) {
	entries, err := os.ReadDir(s.root())
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.TrashItem{}, nil
		}
		return nil, err
	}
	if retentionDays <= 0 {
		retentionDays = 7
	}
	var out []domain.TrashItem
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		bucket := filepath.Join(s.root(), e.Name())
		deletedAt := parseBucketTime(e.Name())
		if deletedAt.IsZero() {
			if info, err := e.Info(); err == nil {
				deletedAt = info.ModTime()
			} else {
				deletedAt = time.Now()
			}
		}
		expires := deletedAt.AddDate(0, 0, retentionDays)
		_ = filepath.WalkDir(bucket, func(path string, d os.DirEntry, err error) error {
			if err != nil || d == nil || !d.IsDir() {
				return err
			}
			if _, err := os.Stat(filepath.Join(path, "SKILL.md")); err != nil {
				return nil
			}
			rel, err := filepath.Rel(bucket, path)
			if err != nil || rel == "." {
				return nil
			}
			id := filepath.ToSlash(rel)
			name := filepath.Base(id)
			if n, _ := readSkillName(filepath.Join(path, "SKILL.md")); n != "" {
				name = n
			}
			out = append(out, domain.TrashItem{
				ID:        id,
				Name:      name,
				TrashPath: path,
				DeletedAt: deletedAt.Format(time.RFC3339),
				ExpiresAt: expires.Format(time.RFC3339),
			})
			return filepath.SkipDir
		})
	}
	return out, nil
}

func (s *Store) Restore(trashPath string, overwrite bool) error {
	abs, err := s.validateTrashPath(trashPath)
	if err != nil {
		return err
	}
	// 找到所属 bucket：_trash/<ts>/...
	relToRoot, err := filepath.Rel(s.root(), abs)
	if err != nil {
		return err
	}
	parts := strings.Split(filepath.ToSlash(relToRoot), "/")
	if len(parts) < 2 {
		return fmt.Errorf("无效的回收站条目")
	}
	id := strings.Join(parts[1:], "/")
	if id == "" || strings.Contains(id, "..") {
		return fmt.Errorf("skill id 非法: %s", id)
	}
	leaf := parts[len(parts)-1]
	var hubDest string
	if len(parts) == 2 {
		// 仓外迁入只保留了 basename，恢复到 default/<leaf> 以便扫描可见。
		hubDest = filepath.Join(s.Hub, domain.DefaultGroup, leaf)
	} else {
		hubDest = filepath.Join(append([]string{s.Hub}, strings.Split(id, "/")...)...)
		// _trash/<ts>/group/leaf：原分组目录不存在时回落到 default/leaf
		if len(parts) >= 3 {
			group := parts[1]
			if group != domain.DefaultGroup {
				if _, err := os.Stat(filepath.Join(s.Hub, group)); os.IsNotExist(err) {
					hubDest = filepath.Join(s.Hub, domain.DefaultGroup, leaf)
				}
			}
		}
	}
	if _, err := os.Lstat(hubDest); err == nil {
		if !overwrite {
			return ErrTargetExists
		}
		if _, err := s.Move(hubDest); err != nil {
			return err
		}
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(hubDest), 0o755); err != nil {
		return err
	}
	if err := os.Rename(abs, hubDest); err != nil {
		return err
	}
	parent := filepath.Dir(abs)
	if ents, err := os.ReadDir(parent); err == nil && len(ents) == 0 {
		_ = os.Remove(parent)
	}
	return nil
}

func (s *Store) PurgeEntry(trashPath string) error {
	abs, err := s.validateTrashPath(trashPath)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(abs); err != nil {
		return err
	}
	// 向上清理空目录，直到（但不删除）trash root hub/_trash
	root, err := filepath.Abs(s.root())
	if err != nil {
		return nil
	}
	root = filepath.Clean(root)
	dir := filepath.Dir(abs)
	for {
		d := filepath.Clean(dir)
		if strings.EqualFold(d, root) {
			break
		}
		// 安全：不得越过 trash root
		rel, err := filepath.Rel(root, d)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			break
		}
		ents, err := os.ReadDir(d)
		if err != nil || len(ents) > 0 {
			break
		}
		if err := os.Remove(d); err != nil {
			break
		}
		dir = filepath.Dir(d)
	}
	return nil
}

func parseBucketTime(name string) time.Time {
	t, err := time.ParseInLocation("20060102-150405", name, time.Local)
	if err != nil {
		return time.Time{}
	}
	return t
}

func readSkillName(skillMD string) (string, error) {
	f, err := os.Open(skillMD)
	if err != nil {
		return "", err
	}
	defer f.Close()
	buf := make([]byte, 4096)
	n, _ := f.Read(buf)
	content := bytes.TrimPrefix(buf[:n], []byte{0xEF, 0xBB, 0xBF})
	inFence := false
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if line == "---" {
			if !inFence {
				inFence = true
				continue
			}
			break
		}
		if !inFence {
			continue
		}
		if strings.HasPrefix(line, "name:") {
			name := strings.TrimSpace(strings.TrimPrefix(line, "name:"))
			return strings.Trim(name, `"'`), nil
		}
	}
	return "", nil
}

func (s *Store) PurgeOlderThan(days int) error {
	if days <= 0 {
		return nil
	}
	entries, err := os.ReadDir(s.root())
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	cutoff := time.Now().AddDate(0, 0, -days)
	for _, e := range entries {
		p := filepath.Join(s.root(), e.Name())
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			_ = os.RemoveAll(p)
		}
	}
	return nil
}
