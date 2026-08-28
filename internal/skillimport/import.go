package skillimport

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
)

// Import copies skill directories and skills inside zip/.skill archives into hub/default.
// Existing ids are skipped. Sources are never modified.
func Import(hubRoot string, paths []string) (domain.ImportSkillsResult, error) {
	res := domain.ImportSkillsResult{Items: []domain.ImportSkillItem{}}
	if strings.TrimSpace(hubRoot) == "" {
		return res, fmt.Errorf("源仓路径为空")
	}
	if err := os.MkdirAll(filepath.Join(hubRoot, domain.DefaultGroup), 0o755); err != nil {
		return res, err
	}

	seen := map[string]struct{}{}
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		abs, err := filepath.Abs(p)
		if err != nil {
			res.Items = append(res.Items, failItem(filepath.Base(p), err.Error()))
			res.Failed++
			continue
		}

		cands, cleanup, err := collectCandidates(abs)
		if err != nil {
			if cleanup != nil {
				cleanup()
			}
			res.Items = append(res.Items, failItem(filepath.Base(abs), err.Error()))
			res.Failed++
			continue
		}
		if len(cands) == 0 {
			if cleanup != nil {
				cleanup()
			}
			res.Items = append(res.Items, failItem(filepath.Base(abs), "未找到可导入的 skill（需含 SKILL.md）"))
			res.Failed++
			continue
		}
		for _, c := range cands {
			item := importOne(hubRoot, c, seen)
			res.Items = append(res.Items, item)
			switch item.Status {
			case domain.ImportStatusImported:
				res.Imported++
			case domain.ImportStatusSkipped:
				res.Skipped++
			default:
				res.Failed++
			}
		}
		if cleanup != nil {
			cleanup()
		}
	}
	return res, nil
}

type candidate struct {
	id  string
	src string // absolute directory containing SKILL.md
}

func collectCandidates(path string) ([]candidate, func(), error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, nil, err
	}
	if !st.IsDir() {
		if isZipSkillPackage(path) {
			return candidatesFromZip(path)
		}
		return nil, nil, fmt.Errorf("不支持的文件类型（请拖入 skill 文件夹、zip 或 .skill 包）")
	}
	if fsutil.IsSkillDir(path) {
		return []candidate{{id: filepath.Base(path), src: path}}, nil, nil
	}
	ents, err := os.ReadDir(path)
	if err != nil {
		return nil, nil, err
	}
	var out []candidate
	for _, e := range ents {
		if !e.IsDir() || fsutil.ShouldSkipDir(e.Name()) {
			continue
		}
		child := filepath.Join(path, e.Name())
		if fsutil.IsSkillDir(child) {
			out = append(out, candidate{id: e.Name(), src: child})
		}
	}
	return out, nil, nil
}

const (
	maxZipSkills        = 200
	maxZipFilesPerSkill = 5000
	maxZipFileBytes     = 32 << 20  // 32 MiB
	maxZipTotalBytes    = 256 << 20 // 256 MiB
)

// isZipSkillPackage reports whether path is a zip-based skill archive
// (.zip export pack or Claude/Cursor .skill package).
func isZipSkillPackage(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".zip" || ext == ".skill"
}

func candidatesFromZip(zipPath string) ([]candidate, func(), error) {
	return candidatesFromZipDepth(zipPath, 0)
}

func candidatesFromZipDepth(zipPath string, depth int) ([]candidate, func(), error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, nil, fmt.Errorf("无法打开压缩包: %w", err)
	}
	defer zr.Close()

	ids := topLevelSkillIDs(&zr.Reader)
	var nested []string
	if depth == 0 {
		nested = topLevelNestedArchives(&zr.Reader)
	}
	if len(ids) == 0 && len(nested) == 0 {
		return nil, nil, nil
	}
	if len(ids)+len(nested) > maxZipSkills {
		return nil, nil, fmt.Errorf("zip 内 skill 过多（>%d）", maxZipSkills)
	}

	tmp, err := os.MkdirTemp("", "skillsmanager-import-*")
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() { _ = os.RemoveAll(tmp) }

	var totalBytes int64
	var out []candidate
	for _, id := range ids {
		dest := filepath.Join(tmp, id)
		if err := extractSkillFromZip(&zr.Reader, id, dest, &totalBytes); err != nil {
			cleanup()
			return nil, nil, fmt.Errorf("解压 %s 失败: %w", id, err)
		}
		out = append(out, candidate{id: id, src: dest})
	}
	for _, name := range nested {
		innerPath := filepath.Join(tmp, "_nested", filepath.Base(name))
		if err := extractNamedZipFile(&zr.Reader, name, innerPath, &totalBytes); err != nil {
			cleanup()
			return nil, nil, fmt.Errorf("解压 %s 失败: %w", name, err)
		}
		inner, innerCleanup, err := candidatesFromZipDepth(innerPath, depth+1)
		if err != nil {
			if innerCleanup != nil {
				innerCleanup()
			}
			cleanup()
			return nil, nil, err
		}
		if innerCleanup != nil {
			prev := cleanup
			cleanup = func() {
				innerCleanup()
				prev()
			}
		}
		out = append(out, inner...)
		if len(out) > maxZipSkills {
			cleanup()
			return nil, nil, fmt.Errorf("zip 内 skill 过多（>%d）", maxZipSkills)
		}
	}
	return out, cleanup, nil
}

func topLevelNestedArchives(zr *zip.Reader) []string {
	seen := map[string]struct{}{}
	var names []string
	for _, f := range zr.File {
		name := filepath.ToSlash(f.Name)
		name = strings.TrimPrefix(name, "./")
		if name == "" || strings.Contains(name, "..") || strings.Contains(name, "/") {
			continue
		}
		if f.FileInfo().IsDir() || strings.HasSuffix(name, "/") {
			continue
		}
		if !isZipSkillPackage(name) {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}
	return names
}

func extractNamedZipFile(zr *zip.Reader, name, dest string, totalBytes *int64) error {
	for _, f := range zr.File {
		entry := filepath.ToSlash(f.Name)
		entry = strings.TrimPrefix(entry, "./")
		if entry != name {
			continue
		}
		if f.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("zip 含符号链接，已拒绝: %s", f.Name)
		}
		if f.UncompressedSize64 > maxZipFileBytes {
			return fmt.Errorf("文件过大（>%d bytes）: %s", maxZipFileBytes, f.Name)
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		n, err := writeZipFile(f, dest)
		if err != nil {
			return err
		}
		*totalBytes += n
		if *totalBytes > maxZipTotalBytes {
			return fmt.Errorf("zip 解压总量过大（>%d bytes）", maxZipTotalBytes)
		}
		return nil
	}
	return fmt.Errorf("zip 内缺少 %s", name)
}

func topLevelSkillIDs(zr *zip.Reader) []string {
	seen := map[string]struct{}{}
	var ids []string
	for _, f := range zr.File {
		name := filepath.ToSlash(f.Name)
		name = strings.TrimPrefix(name, "./")
		if name == "" || strings.Contains(name, "..") {
			continue
		}
		parts := strings.Split(name, "/")
		if len(parts) >= 2 && parts[1] == "SKILL.md" && parts[0] != "" {
			if _, ok := seen[parts[0]]; ok {
				continue
			}
			seen[parts[0]] = struct{}{}
			ids = append(ids, parts[0])
		}
	}
	return ids
}

func extractSkillFromZip(zr *zip.Reader, id, dest string, totalBytes *int64) error {
	prefix := id + "/"
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return err
	}
	fileCount := 0
	for _, f := range zr.File {
		name := filepath.ToSlash(f.Name)
		name = strings.TrimPrefix(name, "./")
		if name != id && !strings.HasPrefix(name, prefix) {
			continue
		}
		if name == id || strings.HasSuffix(name, "/") && strings.TrimSuffix(name, "/") == id {
			continue
		}
		rel := strings.TrimPrefix(name, prefix)
		if rel == "" || strings.Contains(rel, "..") {
			continue
		}
		if f.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("zip 含符号链接，已拒绝: %s", f.Name)
		}
		target := filepath.Join(dest, filepath.FromSlash(rel))
		target = filepath.Clean(target)
		destClean := filepath.Clean(dest)
		if target != destClean && !strings.HasPrefix(target, destClean+string(os.PathSeparator)) {
			return fmt.Errorf("zip 路径越界: %s", f.Name)
		}
		if f.FileInfo().IsDir() || strings.HasSuffix(name, "/") {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		fileCount++
		if fileCount > maxZipFilesPerSkill {
			return fmt.Errorf("单个 skill 文件过多（>%d）", maxZipFilesPerSkill)
		}
		if f.UncompressedSize64 > maxZipFileBytes {
			return fmt.Errorf("文件过大（>%d bytes）: %s", maxZipFileBytes, f.Name)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		n, err := writeZipFile(f, target)
		if err != nil {
			return err
		}
		*totalBytes += n
		if *totalBytes > maxZipTotalBytes {
			return fmt.Errorf("zip 解压总量过大（>%d bytes）", maxZipTotalBytes)
		}
	}
	if !fsutil.IsSkillDir(dest) {
		return fmt.Errorf("解压后缺少 SKILL.md")
	}
	return nil
}

func writeZipFile(f *zip.File, dest string) (int64, error) {
	rc, err := f.Open()
	if err != nil {
		return 0, err
	}
	defer rc.Close()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return 0, err
	}
	defer out.Close()
	written, err := io.Copy(out, io.LimitReader(rc, maxZipFileBytes+1))
	if err != nil {
		return written, err
	}
	if written > maxZipFileBytes {
		return written, fmt.Errorf("文件过大（>%d bytes）: %s", maxZipFileBytes, f.Name)
	}
	return written, nil
}

func importOne(hubRoot string, c candidate, seen map[string]struct{}) domain.ImportSkillItem {
	id := fsutil.NormalizeSkillID(c.id)
	if err := validateID(id); err != nil {
		return failItem(c.id, err.Error())
	}
	if _, ok := seen[id]; ok {
		return skipItem(id, "本次导入中重复")
	}
	seen[id] = struct{}{}

	if skillExists(hubRoot, id) {
		return skipItem(id, "源仓中已存在")
	}

	dst := filepath.Join(hubRoot, domain.DefaultGroup, id)
	if err := copySkillDir(c.src, dst); err != nil {
		_ = os.RemoveAll(dst)
		return failItem(id, err.Error())
	}
	if !fsutil.IsSkillDir(dst) {
		_ = os.RemoveAll(dst)
		return failItem(id, "导入结果不是有效 skill（缺少 SKILL.md）")
	}
	return domain.ImportSkillItem{ID: id, Status: domain.ImportStatusImported}
}

func validateID(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("skill id 不能为空")
	}
	if strings.Contains(id, "/") || strings.ContainsAny(id, `\`) {
		return fmt.Errorf("skill id 非法: %s", id)
	}
	if id == "." || id == ".." || strings.Contains(id, "..") {
		return fmt.Errorf("skill id 非法: %s", id)
	}
	if fsutil.ShouldSkipDir(id) {
		return fmt.Errorf("skill id 保留名不可用: %s", id)
	}
	return nil
}

func skillExists(hubRoot, id string) bool {
	ents, err := os.ReadDir(hubRoot)
	if err != nil {
		return false
	}
	for _, e := range ents {
		if !e.IsDir() || fsutil.ShouldSkipDir(e.Name()) {
			continue
		}
		if fsutil.IsSkillDir(filepath.Join(hubRoot, e.Name(), id)) {
			return true
		}
	}
	return false
}

func copySkillDir(src, dst string) error {
	if fi, err := os.Lstat(src); err == nil && fi.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("含符号链接，已拒绝: %s", src)
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("含符号链接，已拒绝: %s", path)
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(path, target)
	})
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func failItem(id, reason string) domain.ImportSkillItem {
	return domain.ImportSkillItem{ID: id, Status: domain.ImportStatusFailed, Reason: reason}
}

func skipItem(id, reason string) domain.ImportSkillItem {
	return domain.ImportSkillItem{ID: id, Status: domain.ImportStatusSkipped, Reason: reason}
}
