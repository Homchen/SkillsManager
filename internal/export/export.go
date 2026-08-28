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

func uniqueNumberedZip(dir, baseName string) string {
	p := filepath.Join(dir, baseName+".zip")
	if _, err := os.Stat(p); os.IsNotExist(err) {
		return p
	}
	for i := 2; i < 1000; i++ {
		cand := filepath.Join(dir, fmt.Sprintf("%s-%d.zip", baseName, i))
		if _, err := os.Stat(cand); os.IsNotExist(err) {
			return cand
		}
	}
	return filepath.Join(dir, fmt.Sprintf("%s-%d.zip", baseName, time.Now().UnixNano()))
}

func UniqueZipPath(dir, toolID string, now time.Time) string {
	safe := sanitizeToolID(toolID)
	stamp := now.Format("20060102-150405")
	return uniqueNumberedZip(dir, fmt.Sprintf("%s-%s", safe, stamp))
}

func UniqueDateZipPath(dir, prefix string, now time.Time) string {
	safe := sanitizeToolID(prefix)
	stamp := now.Format("20060102")
	return uniqueNumberedZip(dir, fmt.Sprintf("%s-%s", safe, stamp))
}

func UniqueNamedZipPath(dir, name string) string {
	return uniqueNumberedZip(dir, sanitizeToolID(name))
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

func sortedSkillIDs(skillDirs map[string]string) []string {
	ids := make([]string, 0, len(skillDirs))
	for id := range skillDirs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func writeZipFile(zipPath string, write func(zw *zip.Writer) error) error {
	tmp := zipPath + ".tmp"
	_ = os.Remove(tmp)
	f, err := os.Create(tmp)
	if err != nil {
		return err
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
	if err := write(zw); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	okClose = true
	if err := os.Rename(tmp, zipPath); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// ZipSkillArchives writes one inner <skillID>.zip (dir layout) per skill into zipPath.
func ZipSkillArchives(zipPath string, skillDirs map[string]string) (exported, skipped int, err error) {
	ids := sortedSkillIDs(skillDirs)
	tmpDir, err := os.MkdirTemp("", "skillsmanager-export-*")
	if err != nil {
		return 0, 0, err
	}
	defer os.RemoveAll(tmpDir)

	type packed struct {
		name string
		path string
	}
	var files []packed
	for _, id := range ids {
		inner := filepath.Join(tmpDir, sanitizeToolID(id)+".zip")
		n, sk, zipErr := ZipSkillDirs(inner, map[string]string{id: skillDirs[id]})
		if zipErr != nil {
			return exported, skipped, zipErr
		}
		skipped += sk
		if n == 0 {
			continue
		}
		files = append(files, packed{name: id + ".zip", path: inner})
		exported++
	}
	if exported == 0 {
		return 0, skipped, nil
	}
	err = writeZipFile(zipPath, func(zw *zip.Writer) error {
		for _, file := range files {
			hdr := &zip.FileHeader{Name: file.name, Method: zip.Store}
			w, createErr := zw.CreateHeader(hdr)
			if createErr != nil {
				return createErr
			}
			src, openErr := os.Open(file.path)
			if openErr != nil {
				return openErr
			}
			_, copyErr := io.Copy(w, src)
			_ = src.Close()
			if copyErr != nil {
				return copyErr
			}
		}
		return nil
	})
	if err != nil {
		return 0, 0, err
	}
	return exported, skipped, nil
}

func normalizeExportIDs(ids []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, raw := range ids {
		id := fsutil.NormalizeSkillID(strings.TrimSpace(raw))
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func packSkills(hubRoot, exportDir, zipPath string, ids []string, entries []domain.SkillEntry, asArchives bool) (domain.ExportToolSkillsResult, error) {
	if err := os.MkdirAll(exportDir, 0o755); err != nil {
		return domain.ExportToolSkillsResult{}, fmt.Errorf("创建导出目录失败: %w", err)
	}
	skillDirs := make(map[string]string, len(ids))
	for _, id := range ids {
		skillDirs[id] = hubDirForExport(hubRoot, entries, id)
	}
	var exported, skipped int
	var err error
	if asArchives {
		exported, skipped, err = ZipSkillArchives(zipPath, skillDirs)
	} else {
		exported, skipped, err = ZipSkillDirs(zipPath, skillDirs)
	}
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

func Export(hubRoot, exportDir, toolID string, entries []domain.SkillEntry, now time.Time) (domain.ExportToolSkillsResult, error) {
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		return domain.ExportToolSkillsResult{}, fmt.Errorf("工具 ID 为空")
	}
	ids := EnabledSkillIDs(entries, toolID)
	if len(ids) == 0 {
		return domain.ExportToolSkillsResult{}, fmt.Errorf("该工具目录下没有已启用的 skill")
	}
	zipPath := UniqueZipPath(exportDir, toolID, now)
	return packSkills(hubRoot, exportDir, zipPath, ids, entries, false)
}

// ExportSelected zips hub sources for the given skill IDs.
// One skill becomes <id>.zip with that skill directory inside.
// Two or more become skill-export-YYYYMMDD.zip containing one <id>.zip per skill.
func ExportSelected(hubRoot, exportDir string, ids []string, entries []domain.SkillEntry, now time.Time) (domain.ExportToolSkillsResult, error) {
	ids = normalizeExportIDs(ids)
	if len(ids) == 0 {
		return domain.ExportToolSkillsResult{}, fmt.Errorf("未选择 skill")
	}
	if len(ids) == 1 {
		zipPath := UniqueNamedZipPath(exportDir, ids[0])
		return packSkills(hubRoot, exportDir, zipPath, ids, entries, false)
	}
	zipPath := UniqueDateZipPath(exportDir, "skill-export", now)
	return packSkills(hubRoot, exportDir, zipPath, ids, entries, true)
}
