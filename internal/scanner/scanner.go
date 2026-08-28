package scanner

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
)

// Scan walks the hub and enabled tool roots, classifies skill locations, and derives status.
func Scan(cfg config.Config) ([]domain.SkillEntry, error) {
	byID := map[string]*domain.SkillEntry{}

	for _, tool := range cfg.Tools {
		if !tool.Enabled {
			continue
		}
		if tool.Path == "" {
			continue
		}
		if _, err := os.Stat(tool.Path); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		if tool.IsHub {
			if err := walkHub(tool.Path, byID); err != nil {
				return nil, err
			}
			continue
		}
		if err := walkRoot(tool.Path, tool.ID, false, byID); err != nil {
			return nil, err
		}
	}

	// Ensure hub is scanned even if missing from Tools.
	hubScanned := false
	for _, tool := range cfg.Tools {
		if tool.Enabled && tool.IsHub && tool.Path != "" {
			hubScanned = true
			break
		}
	}
	if !hubScanned && cfg.HubPath != "" {
		if _, err := os.Stat(cfg.HubPath); err == nil {
			if err := walkHub(cfg.HubPath, byID); err != nil {
				return nil, err
			}
		}
	}

	entries := make([]domain.SkillEntry, 0, len(byID))
	for _, e := range byID {
		fillMeta(e)
		if e.Group == "" && e.HubPath != "" && cfg.HubPath != "" {
			if rel, err := filepath.Rel(cfg.HubPath, e.HubPath); err == nil {
				parts := strings.Split(filepath.ToSlash(rel), "/")
				if len(parts) >= 2 && parts[0] != ".." && parts[0] != "." {
					e.Group = parts[0]
				}
			}
		}
		e.Status = deriveStatus(e)
		entries = append(entries, *e)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	return entries, nil
}

// DeepScan walks home with the same skill discovery rules. cancel/onProgress are optional.
// Skips hub and enabled tool roots (already covered by Scan), plus name-based ignore lists.
func DeepScan(home string, cfg config.Config, cancel <-chan struct{}, onProgress func(string)) ([]domain.SkillEntry, error) {
	byID := map[string]*domain.SkillEntry{}
	extraSkip := map[string]struct{}{}
	for _, n := range cfg.DeepScanIgnoreExtra {
		extraSkip[n] = struct{}{}
	}
	skipRoots := deepScanSkipRoots(cfg)

	err := filepath.WalkDir(home, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			// 主目录下常见无权限/不存在的系统目录：跳过继续扫，不让整次深度扫描失败。
			if os.IsNotExist(err) || os.IsPermission(err) {
				if d != nil && d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			return err
		}
		select {
		case <-cancel:
			return errCancelled
		default:
		}
		if onProgress != nil && d.IsDir() {
			onProgress(path)
		}
		if d.IsDir() && path != home {
			if pathUnderAnyRoot(path, skipRoots) {
				return filepath.SkipDir
			}
			if fsutil.ShouldSkipDir(d.Name()) {
				return filepath.SkipDir
			}
			if _, ok := extraSkip[d.Name()]; ok {
				return filepath.SkipDir
			}
		}
		return visitEntry(home, "orphan", false, path, d, byID)
	})
	if err == errCancelled {
		err = nil
	}
	if err != nil {
		return nil, err
	}

	entries := make([]domain.SkillEntry, 0, len(byID))
	for _, e := range byID {
		fillMeta(e)
		e.Status = deriveStatus(e)
		entries = append(entries, *e)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	return entries, nil
}

func deepScanSkipRoots(cfg config.Config) []string {
	roots := make([]string, 0, 1+len(cfg.Tools))
	if cfg.HubPath != "" {
		roots = append(roots, absClean(cfg.HubPath))
	}
	for _, t := range cfg.Tools {
		if !t.Enabled || t.Path == "" {
			continue
		}
		roots = append(roots, absClean(t.Path))
	}
	return roots
}

func pathUnderAnyRoot(path string, roots []string) bool {
	clean := absClean(path)
	for _, root := range roots {
		if root == "" {
			continue
		}
		if fsutil.SamePath(clean, root) {
			return true
		}
		rel, err := filepath.Rel(root, clean)
		if err != nil {
			continue
		}
		if rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// skillIDForScan derives the skill id for a discovered path.
// Deep-scan orphans use a path relative to home so same-leaf copies stay distinct;
// move_to_hub still lands under hub/default/<leaf>. Configured tool roots keep
// path-relative ids as well.
func skillIDForScan(root, toolID, path string) (string, error) {
	id, err := fsutil.RelSkillID(root, path)
	if err != nil {
		return "", err
	}
	if id == "" || id == "." {
		if toolID == "orphan" {
			return "", fmt.Errorf("empty orphan skill id")
		}
		return "", fmt.Errorf("empty skill id")
	}
	return id, nil
}

type cancelError struct{}

func (cancelError) Error() string { return "scan cancelled" }

var errCancelled = cancelError{}

func walkHub(hub string, byID map[string]*domain.SkillEntry) error {
	ents, err := os.ReadDir(hub)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, g := range ents {
		if !g.IsDir() || fsutil.ShouldSkipDir(g.Name()) {
			continue
		}
		groupDir := filepath.Join(hub, g.Name())
		if fsutil.IsSkillDir(groupDir) {
			// 未迁移的根 skill：跳过（由 Migrate 处理）；避免错误 id
			continue
		}
		children, err := os.ReadDir(groupDir)
		if err != nil {
			return err
		}
		for _, c := range children {
			if !c.IsDir() || fsutil.ShouldSkipDir(c.Name()) {
				continue
			}
			skillDir := filepath.Join(groupDir, c.Name())
			if !fsutil.IsSkillDir(skillDir) {
				continue
			}
			id := fsutil.NormalizeSkillID(c.Name())
			addLocation(byID, id, domain.SkillLocation{
				ToolID: "skills",
				Path:   skillDir,
				Kind:   domain.KindHub,
			})
			e := byID[id]
			e.HubPath = skillDir
			e.Group = g.Name()
		}
	}
	return nil
}

func walkRoot(root, toolID string, isHub bool, byID map[string]*domain.SkillEntry) error {
	return filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if d.IsDir() && path != root && fsutil.ShouldSkipDir(d.Name()) {
			return filepath.SkipDir
		}
		return visitEntry(root, toolID, isHub, path, d, byID)
	})
}

func visitEntry(root, toolID string, isHub bool, path string, d os.DirEntry, byID map[string]*domain.SkillEntry) error {
	if path == root {
		return nil
	}

	isSymlink := d.Type()&os.ModeSymlink != 0
	if !isSymlink {
		// DirEntry.Type may be zero; confirm with Lstat.
		fi, err := os.Lstat(path)
		if err != nil {
			return nil
		}
		isSymlink = fi.Mode()&os.ModeSymlink != 0
	}

	if isSymlink {
		return recordSymlink(root, toolID, path, byID)
	}

	if !d.IsDir() {
		return nil
	}
	if !fsutil.IsSkillDir(path) {
		return nil
	}

	id, err := skillIDForScan(root, toolID, path)
	if err != nil || id == "" || id == "." {
		return nil
	}

	kind := domain.KindRealCopy
	if isHub {
		kind = domain.KindHub
	}
		addLocation(byID, id, domain.SkillLocation{
			ToolID: toolID,
			Path:   path,
			Kind:   kind,
		})
		if isHub {
			e := byID[id]
			e.HubPath = path
		}
		return filepath.SkipDir
	}

func recordSymlink(root, toolID, path string, byID map[string]*domain.SkillEntry) error {
	id, err := skillIDForScan(root, toolID, path)
	if err != nil || id == "" || id == "." {
		return nil
	}

	target, err := os.Readlink(path)
	if err != nil {
		return nil
	}
	if !filepath.IsAbs(target) {
		target = filepath.Join(filepath.Dir(path), target)
	}
	target = filepath.Clean(target)

	absTarget, err := filepath.Abs(target)
	if err == nil {
		target = absTarget
	}

	if _, err := os.Stat(target); err != nil {
		addLocation(byID, id, domain.SkillLocation{
			ToolID:     toolID,
			Path:       path,
			Kind:       domain.KindBrokenLink,
			LinkTarget: target,
		})
		return nil
	}

	if !fsutil.IsSkillDir(target) {
		return nil
	}

	addLocation(byID, id, domain.SkillLocation{
		ToolID:     toolID,
		Path:       path,
		Kind:       domain.KindSymlink,
		LinkTarget: target,
	})
	return nil
}

func addLocation(byID map[string]*domain.SkillEntry, id string, loc domain.SkillLocation) {
	e, ok := byID[id]
	if !ok {
		e = &domain.SkillEntry{ID: id}
		byID[id] = e
	}
	e.Locations = append(e.Locations, loc)
}

func fillMeta(e *domain.SkillEntry) {
	candidates := make([]string, 0, len(e.Locations)+1)
	if e.HubPath != "" {
		candidates = append(candidates, e.HubPath)
	}
	for _, loc := range e.Locations {
		switch loc.Kind {
		case domain.KindHub:
			if e.HubPath == "" {
				e.HubPath = loc.Path
			}
			candidates = append(candidates, loc.Path)
		case domain.KindRealCopy:
			candidates = append(candidates, loc.Path)
		case domain.KindSymlink:
			if loc.LinkTarget != "" {
				candidates = append(candidates, loc.LinkTarget)
			}
		}
	}
	for _, dir := range candidates {
		name, desc := parseFrontmatter(filepath.Join(dir, "SKILL.md"))
		if e.Name == "" && name != "" {
			e.Name = name
		}
		if e.Description == "" && desc != "" {
			e.Description = desc
		}
		if e.Name != "" && e.Description != "" {
			break
		}
	}
	if e.Name == "" {
		e.Name = filepath.Base(e.ID)
	}
}

func deriveStatus(e *domain.SkillEntry) domain.SkillStatus {
	var hasHub, hasSymlink, hasReal, hasBroken bool
	hubPath := e.HubPath
	realPaths := make([]string, 0)
	symlinks := make([]domain.SkillLocation, 0)
	for _, loc := range e.Locations {
		switch loc.Kind {
		case domain.KindHub:
			hasHub = true
			if hubPath == "" {
				hubPath = loc.Path
			}
		case domain.KindSymlink:
			hasSymlink = true
			symlinks = append(symlinks, loc)
		case domain.KindRealCopy:
			hasReal = true
			realPaths = append(realPaths, loc.Path)
		case domain.KindBrokenLink:
			hasBroken = true
		}
	}
	if hubPath != "" {
		hasHub = true
	}

	if hasReal {
		roots := make([]string, 0, len(realPaths)+1)
		if hubPath != "" {
			roots = append(roots, hubPath)
		}
		roots = append(roots, realPaths...)
		if fsutil.SkillDirsContentDiffer(roots) {
			return domain.StatusConflict
		}
		return domain.StatusRealCopyOnly
	}

	if hasBroken {
		return domain.StatusBrokenLink
	}
	if hasHub && !hasSymlink {
		return domain.StatusHubOnly
	}
	if hasHub && hasSymlink {
		if allSymlinksPointToHub(symlinks, hubPath) {
			return domain.StatusNormal
		}
		return domain.StatusBrokenLink
	}
	// Symlink-only without a hub real dir is not normal.
	if hasSymlink {
		return domain.StatusBrokenLink
	}
	return domain.StatusHubOnly
}

func allSymlinksPointToHub(links []domain.SkillLocation, hubPath string) bool {
	if hubPath == "" || len(links) == 0 {
		return false
	}
	hubAbs := absClean(hubPath)
	for _, loc := range links {
		if loc.LinkTarget == "" {
			return false
		}
		if !fsutil.SamePath(absClean(loc.LinkTarget), hubAbs) {
			return false
		}
	}
	return true
}

func absClean(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		return filepath.Clean(p)
	}
	return filepath.Clean(abs)
}
