package organizer

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
	"SkillsManager/internal/linker"
	"SkillsManager/internal/trash"
)

// FindRestorableOrphanLinks finds directory symlinks outside tool roots that point
// into the hub (leftovers from mistaken deep-scan move_to_hub).
//
// Discovery is hub-first: for each skill dir under hub, check whether
// home/<rel-from-hub> is a symlink to that skill. This matches the old bug that
// moved orphans to hub/<relative-home-path> and relinked the original location.
// A home walk is used as a fallback for other hub-pointing orphan links.
func FindRestorableOrphanLinks(
	home string,
	cfg config.Config,
	onProgress func(string),
) ([]domain.RestoreOrphanItem, error) {
	if home == "" {
		return nil, fmt.Errorf("主目录为空")
	}
	hub := absCleanPreferLong(cfg.HubPath)
	if hub == "" {
		return nil, fmt.Errorf("源仓路径为空")
	}
	home = absCleanPreferLong(home)

	seen := map[string]struct{}{}
	var out []domain.RestoreOrphanItem
	add := func(it domain.RestoreOrphanItem) {
		key := strings.ToLower(absCleanNoEval(it.LinkPath))
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, it)
	}

	toolRoots := toolRootsAbs(cfg)
	if err := collectRestoreFromHub(home, hub, toolRoots, onProgress, add); err != nil {
		return nil, err
	}
	if err := collectRestoreFromHomeWalk(home, hub, cfg, toolRoots, onProgress, add); err != nil {
		return nil, err
	}

	sort.Slice(out, func(i, j int) bool { return out[i].LinkPath < out[j].LinkPath })
	return out, nil
}

func toolRootsAbs(cfg config.Config) []string {
	roots := make([]string, 0, len(cfg.Tools))
	for _, t := range cfg.Tools {
		if !t.Enabled || t.Path == "" || t.IsHub {
			continue
		}
		roots = append(roots, absCleanPreferLong(t.Path))
	}
	return roots
}

func collectRestoreFromHub(
	home, hub string,
	toolRoots []string,
	onProgress func(string),
	add func(domain.RestoreOrphanItem),
) error {
	return filepath.WalkDir(hub, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) || os.IsPermission(err) {
				if d != nil && d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			return err
		}
		if path == hub {
			return nil
		}
		if d.IsDir() && fsutil.ShouldSkipDir(d.Name()) {
			return filepath.SkipDir
		}
		// Don't follow symlinks inside hub.
		if d.Type()&os.ModeSymlink != 0 {
			return filepath.SkipDir
		}
		if !d.IsDir() || !fsutil.IsSkillDir(path) {
			return nil
		}
		if onProgress != nil {
			onProgress(path)
		}
		rel, err := filepath.Rel(hub, path)
		if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
			return nil
		}
		linkPath := filepath.Join(home, rel)
		if item, ok := restoreCandidateAt(linkPath, path, hub, toolRoots); ok {
			add(item)
		}
		return nil
	})
}

func collectRestoreFromHomeWalk(
	home, hub string,
	cfg config.Config,
	toolRoots []string,
	onProgress func(string),
	add func(domain.RestoreOrphanItem),
) error {
	extraSkip := map[string]struct{}{}
	for _, n := range cfg.DeepScanIgnoreExtra {
		extraSkip[n] = struct{}{}
	}
	skipRoots := append([]string{hub}, toolRoots...)

	return filepath.WalkDir(home, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) || os.IsPermission(err) {
				if d != nil && d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			return err
		}
		if path == home {
			return nil
		}
		if onProgress != nil && d.IsDir() {
			onProgress(path)
		}

		isSymlink := entryIsSymlink(path, d)
		if d.IsDir() || isSymlink {
			if pathUnderRootNoFollow(path, skipRoots) {
				return filepath.SkipDir
			}
			if fsutil.ShouldSkipDir(d.Name()) {
				return filepath.SkipDir
			}
			if _, ok := extraSkip[d.Name()]; ok {
				return filepath.SkipDir
			}
		}
		if !isSymlink {
			return nil
		}
		target, err := absLinkTarget(path)
		if err != nil {
			return filepath.SkipDir
		}
		if item, ok := restoreCandidateAt(path, target, hub, toolRoots); ok {
			add(item)
		}
		return filepath.SkipDir
	})
}

func entryIsSymlink(path string, d os.DirEntry) bool {
	if d.Type()&os.ModeSymlink != 0 {
		return true
	}
	fi, err := os.Lstat(path)
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeSymlink != 0
}

func restoreCandidateAt(linkPath, targetHint, hub string, toolRoots []string) (domain.RestoreOrphanItem, bool) {
	// Link identity must not EvalSymlinks: following parents can collapse the path onto
	// the hub target (or another real directory), and restore then fails with「已不是符号链接」.
	linkAbs := absCleanNoEval(linkPath)
	if pathUnderRootNoEval(linkAbs, toolRoots) || pathUnderRootNoEval(linkAbs, []string{hub}) {
		return domain.RestoreOrphanItem{}, false
	}
	fi, err := os.Lstat(linkAbs)
	if err != nil || fi.Mode()&os.ModeSymlink == 0 {
		return domain.RestoreOrphanItem{}, false
	}
	target, err := absLinkTarget(linkAbs)
	if err != nil {
		return domain.RestoreOrphanItem{}, false
	}
	target = absCleanPreferLong(target)
	hint := absCleanPreferLong(targetHint)
	if hint != "" && !samePathFold(target, hint) {
		// Hub scan passes the hub skill path as hint; require exact match.
		return domain.RestoreOrphanItem{}, false
	}
	if !pathUnderRootFold(target, []string{hub}) {
		return domain.RestoreOrphanItem{}, false
	}
	// Compare link identity without following: EvalSymlinks(link) === target and would
	// falsely look "under hub".
	if samePathNoEval(linkAbs, target) {
		return domain.RestoreOrphanItem{}, false
	}
	if !fsutil.IsSkillDir(target) {
		return domain.RestoreOrphanItem{}, false
	}
	return domain.RestoreOrphanItem{
		LinkPath:   linkAbs,
		TargetPath: target,
		SkillID:    fsutil.NormalizeSkillID(filepath.Base(target)),
	}, true
}

const restoredOrphanMessagePrefix = "已将符号链接还原为真实目录："

func cutRestoredOrphanLink(message string) (string, bool) {
	return strings.CutPrefix(message, restoredOrphanMessagePrefix)
}

// RestoreOrphanLinks removes selected hub-pointing symlinks and moves the real
// skill directories back to the original locations.
func RestoreOrphanLinks(
	items []domain.RestoreOrphanItem,
	linkPaths []string,
	cfg config.Config,
	tr *trash.Store,
) (domain.RestoreOrphanReport, error) {
	var report domain.RestoreOrphanReport
	if tr == nil {
		tr = trash.New(cfg.HubPath)
	}
	hub := absCleanPreferLong(cfg.HubPath)

	for _, raw := range linkPaths {
		it, ok := lookupRestoreItem(items, raw)
		if !ok {
			report.Failed = append(report.Failed, domain.ReportItem{
				SkillID: filepath.Base(raw),
				Message: "不在可恢复列表中，请先重新扫描",
			})
			continue
		}
		if err := restoreOneOrphanLink(it, hub, tr); err != nil {
			report.Failed = append(report.Failed, domain.ReportItem{
				SkillID: it.SkillID,
				Message: err.Error(),
			})
			continue
		}
		report.Succeeded = append(report.Succeeded, domain.ReportItem{
			SkillID: it.SkillID,
			Message: restoredOrphanMessagePrefix + it.LinkPath,
		})
	}
	return report, nil
}

func lookupRestoreItem(items []domain.RestoreOrphanItem, raw string) (domain.RestoreOrphanItem, bool) {
	want := absCleanNoEval(raw)
	for _, it := range items {
		if samePathNoEval(it.LinkPath, want) || samePathNoEval(it.LinkPath, raw) {
			return it, true
		}
	}
	return domain.RestoreOrphanItem{}, false
}

func restoreOneOrphanLink(it domain.RestoreOrphanItem, hub string, tr *trash.Store) error {
	linkAbs := absCleanNoEval(it.LinkPath)
	want := absCleanPreferLong(it.TargetPath)
	if !pathUnderRootFold(want, []string{hub}) {
		return fmt.Errorf("目标不在源仓内，拒绝还原")
	}
	if !fsutil.IsSkillDir(want) {
		return fmt.Errorf("目标不是有效 skill 目录")
	}
	if samePathNoEval(linkAbs, want) || pathUnderRootNoEval(linkAbs, []string{hub}) {
		return fmt.Errorf("恢复路径无效（与源仓目标重合）：%s", linkAbs)
	}

	fi, err := os.Lstat(linkAbs)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("符号链接已不存在，请重新扫描")
		}
		return fmt.Errorf("读取链接失败: %w", err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		return fmt.Errorf("已不是符号链接：%s", linkAbs)
	}
	target, err := absLinkTarget(linkAbs)
	if err != nil {
		return fmt.Errorf("读取链接目标失败: %w", err)
	}
	target = absCleanPreferLong(target)
	if !samePathFold(target, want) {
		return fmt.Errorf("链接目标已变化（当前 %s），请重新扫描", target)
	}
	if err := linker.RemoveSymlink(linkAbs); err != nil {
		return fmt.Errorf("移除符号链接失败: %w", err)
	}
	if err := movePath(want, linkAbs, tr); err != nil {
		_ = linker.EnsureSymlink(linkAbs, want)
		return fmt.Errorf("移回原路径失败: %w", err)
	}
	_ = pruneEmptyParents(filepath.Dir(want), hub)
	return nil
}

func pruneEmptyParents(start, stop string) error {
	cur := absCleanPreferLong(start)
	stop = absCleanPreferLong(stop)
	for cur != "" && !samePathFold(cur, stop) {
		rel, err := filepath.Rel(stop, cur)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return nil
		}
		ents, err := os.ReadDir(cur)
		if err != nil || len(ents) > 0 {
			return nil
		}
		if err := os.Remove(cur); err != nil {
			return nil
		}
		parent := filepath.Dir(cur)
		if samePathFold(parent, cur) {
			return nil
		}
		cur = parent
	}
	return nil
}

func absCleanPreferLong(p string) string {
	if p == "" {
		return ""
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		abs = filepath.Clean(p)
	} else {
		abs = filepath.Clean(abs)
	}
	if long, err := filepath.EvalSymlinks(abs); err == nil {
		return filepath.Clean(long)
	}
	// Path may be missing (e.g. after cut). Resolve the longest existing ancestor.
	return absCleanNoFollow(abs)
}

// absCleanNoFollow absolutizes a path without following a final symlink entry
// (important for restore candidates that are themselves symlinks into the hub).
func absCleanNoFollow(p string) string {
	if p == "" {
		return ""
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return filepath.Clean(p)
	}
	abs = filepath.Clean(abs)
	parent := filepath.Dir(abs)
	base := filepath.Base(abs)
	if parent == abs {
		return abs
	}
	if longParent, err := filepath.EvalSymlinks(parent); err == nil {
		return filepath.Clean(filepath.Join(longParent, base))
	}
	// Walk up until an existing ancestor resolves.
	dir := parent
	suffix := base
	for {
		grand := filepath.Dir(dir)
		if grand == dir {
			return abs
		}
		suffix = filepath.Join(filepath.Base(dir), suffix)
		if long, err := filepath.EvalSymlinks(grand); err == nil {
			return filepath.Clean(filepath.Join(long, suffix))
		}
		dir = grand
	}
}

func samePathFold(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	return strings.EqualFold(absCleanPreferLong(a), absCleanPreferLong(b))
}

func samePathNoFollow(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	return strings.EqualFold(absCleanNoFollow(a), absCleanNoFollow(b))
}

func samePathNoEval(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	return strings.EqualFold(absCleanNoEval(a), absCleanNoEval(b))
}

func pathUnderRootFold(path string, roots []string) bool {
	clean := absCleanPreferLong(path)
	for _, root := range roots {
		if root == "" {
			continue
		}
		r := absCleanPreferLong(root)
		if strings.EqualFold(clean, r) {
			return true
		}
		rel, err := filepath.Rel(r, clean)
		if err != nil {
			continue
		}
		if rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func pathUnderRootNoFollow(path string, roots []string) bool {
	clean := absCleanNoFollow(path)
	for _, root := range roots {
		if root == "" {
			continue
		}
		r := absCleanPreferLong(root)
		if strings.EqualFold(clean, r) {
			return true
		}
		rel, err := filepath.Rel(r, clean)
		if err != nil {
			continue
		}
		if rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func pathUnderRootNoEval(path string, roots []string) bool {
	clean := absCleanNoEval(path)
	for _, root := range roots {
		if root == "" {
			continue
		}
		r := absCleanNoEval(root)
		if strings.EqualFold(clean, r) {
			return true
		}
		rel, err := filepath.Rel(r, clean)
		if err != nil {
			continue
		}
		if rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}
