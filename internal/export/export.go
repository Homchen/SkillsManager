package export

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
)

func EnabledSkillIDs(entries []domain.SkillEntry, toolID string) []string {
	toolID = strings.TrimSpace(toolID)
	seen := map[string]struct{}{}
	var ids []string
	for _, e := range entries {
		for _, loc := range e.Locations {
			if loc.ToolID != toolID {
				continue
			}
			if loc.Kind != domain.KindSymlink && loc.Kind != domain.KindRealCopy {
				continue
			}
			id := fsutil.NormalizeSkillID(e.ID)
			if id == "" {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

func UniqueZipPath(dir, toolID string, now time.Time) string {
	safe := sanitizeToolID(toolID)
	stamp := now.Format("20060102-150405")
	base := fmt.Sprintf("%s-%s.zip", safe, stamp)
	p := filepath.Join(dir, base)
	if _, err := os.Stat(p); os.IsNotExist(err) {
		return p
	}
	for i := 2; i < 1000; i++ {
		cand := filepath.Join(dir, fmt.Sprintf("%s-%s-%d.zip", safe, stamp, i))
		if _, err := os.Stat(cand); os.IsNotExist(err) {
			return cand
		}
	}
	return filepath.Join(dir, fmt.Sprintf("%s-%s-%d.zip", safe, stamp, time.Now().UnixNano()))
}

func sanitizeToolID(id string) string {
	id = strings.TrimSpace(id)
	if id == "" {
		return "tool"
	}
	var b strings.Builder
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	if b.Len() == 0 {
		return "tool"
	}
	return b.String()
}

func hubDirForExport(hubRoot string, entries []domain.SkillEntry, id string) string {
	for _, e := range entries {
		if e.ID == id && e.HubPath != "" {
			return e.HubPath
		}
	}
	return filepath.Join(hubRoot, domain.DefaultGroup, fsutil.NormalizeSkillID(id))
}

// ZipSkillDirs writes skillID -> absolute hub dir into zipPath.
// Missing/non-dir entries increment skipped. Symlinks under a skill dir are skipped (not followed).
func ZipSkillDirs(zipPath string, skillDirs map[string]string) (exported, skipped int, err error) {
	ids := make([]string, 0, len(skillDirs))
	for id := range skillDirs {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	tmp := zipPath + ".tmp"
	_ = os.Remove(tmp)
	f, err := os.Create(tmp)
	if err != nil {
		return 0, 0, err
	}
	zw := zip.NewWriter(f)
	okClose := false
	defer func() {
		if !okClose {
			_ = zw.Close()
			_ = f.Close()
			_ = os.Remove(tmp)
		}
	}()

	for _, id := range ids {
		dir := skillDirs[id]
		st, err := os.Stat(dir)
		if err != nil || !st.IsDir() {
			skipped++
			continue
		}
		err = filepath.WalkDir(dir, func(path string, d os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if d.Type()&os.ModeSymlink != 0 {
				return nil
			}
			rel, err := filepath.Rel(dir, path)
			if err != nil {
				return err
			}
			name := filepath.ToSlash(filepath.Join(id, rel))
			if d.IsDir() {
				if rel == "." {
					return nil
				}
				_, err := zw.Create(name + "/")
				return err
			}
			w, err := zw.Create(name)
			if err != nil {
				return err
			}
			src, err := os.Open(path)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(w, src)
			_ = src.Close()
			return copyErr
		})
		if err != nil {
			return exported, skipped, err
		}
		exported++
	}

	if err := zw.Close(); err != nil {
		return 0, 0, err
	}
	if err := f.Close(); err != nil {
		return 0, 0, err
	}
	okClose = true
	if exported == 0 {
		_ = os.Remove(tmp)
		return 0, skipped, nil
	}
	if err := os.Rename(tmp, zipPath); err != nil {
		_ = os.Remove(tmp)
		return 0, 0, err
	}
	return exported, skipped, nil
}

func Export(hubRoot, exportDir, toolID string, entries []domain.SkillEntry, now time.Time) (domain.ExportToolSkillsResult, error) {
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		return domain.ExportToolSkillsResult{}, fmt.Errorf("工具 ID 为空")
	}
	ids := EnabledSkillIDs(entries, toolID)
	if len(ids) == 0 {
		return domain.ExportToolSkillsResult{}, fmt.Errorf("该工具目录下没有已启用的 skill")
	}
	if err := os.MkdirAll(exportDir, 0o755); err != nil {
		return domain.ExportToolSkillsResult{}, fmt.Errorf("创建导出目录失败: %w", err)
	}
	skillDirs := make(map[string]string, len(ids))
	for _, id := range ids {
		skillDirs[id] = hubDirForExport(hubRoot, entries, id)
	}
	zipPath := UniqueZipPath(exportDir, toolID, now)
	exported, skipped, err := ZipSkillDirs(zipPath, skillDirs)
	if err != nil {
		return domain.ExportToolSkillsResult{}, err
	}
	if exported == 0 {
		return domain.ExportToolSkillsResult{}, fmt.Errorf("未找到可导出的源仓目录")
	}
	abs, err := filepath.Abs(zipPath)
	if err != nil {
		abs = zipPath
	}
	return domain.ExportToolSkillsResult{ZipPath: abs, Exported: exported, Skipped: skipped}, nil
}
