package organizer

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"SkillsManager/internal/applog"
	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
	"SkillsManager/internal/linker"
	"SkillsManager/internal/trash"
)

// Execute applies selected ready actions from the organize plan.
// If tr is nil, a trash.Store rooted at cfg.HubPath is used.
// When CanExecute is false, returns a Chinese error and performs no mutations.
func Execute(plan domain.OrganizePlan, cfg config.Config, tr *trash.Store) (domain.OrganizeReport, error) {
	ok, reason := CanExecute(plan)
	if !ok {
		if reason == "" {
			reason = "存在未决议的冲突，无法执行整理"
		}
		return domain.OrganizeReport{}, fmt.Errorf("%s", reason)
	}
	if tr == nil {
		tr = trash.New(cfg.HubPath)
	}

	report := domain.OrganizeReport{}
	var cuts []cutRecord
	skippedConflict := map[string]bool{}
	for _, c := range plan.Conflicts {
		if c.UserSkipped {
			skippedConflict[c.SkillID] = true
		}
	}

	for _, action := range plan.Actions {
		if !action.Selected || action.Type == domain.ActionSkip || action.Type == domain.ActionSkippedByUser || skippedConflict[action.SkillID] {
			report.Skipped = append(report.Skipped, domain.ReportItem{
				SkillID: action.SkillID,
				Message: skipMessage(action),
			})
			continue
		}

		if err := executeAction(action, plan, cfg, tr, &cuts); err != nil {
			applog.Error("organize action fail", "skillId", action.SkillID, "type", string(action.Type), "err", err)
			report.Failed = append(report.Failed, domain.ReportItem{
				SkillID: action.SkillID,
				Message: err.Error(),
			})
			continue
		}
		applog.Info("organize action ok", "skillId", action.SkillID, "type", string(action.Type))
		report.Succeeded = append(report.Succeeded, domain.ReportItem{
			SkillID: action.SkillID,
			Message: successMessage(action.Type),
		})
	}
	report.SuggestedWorkdirs = FilterSuggestedWorkdirs(cuts, cfg)
	return report, nil
}

func skipMessage(action domain.OrganizeAction) string {
	switch {
	case !action.Selected:
		return "未勾选，已跳过"
	case action.Type == domain.ActionSkippedByUser:
		return "用户跳过"
	default:
		return "无需处理"
	}
}

func successMessage(t domain.ActionType) string {
	switch t {
	case domain.ActionMoveToHub:
		return "已迁入源仓并建立符号链接"
	case domain.ActionReplaceWithSymlink:
		return "已将真实副本替换为符号链接"
	case domain.ActionFixLink:
		return "已修复符号链接"
	case domain.ActionMergeConflict:
		return "已应用冲突合并并建立符号链接"
	default:
		return "完成"
	}
}

func executeAction(action domain.OrganizeAction, plan domain.OrganizePlan, cfg config.Config, tr *trash.Store, cuts *[]cutRecord) error {
	switch action.Type {
	case domain.ActionMoveToHub:
		// 新迁入一律落在 default/<leaf>；深度扫描曾用相对主目录路径当 id，这里取 leaf 避免落错位置。
		hubTarget, err := hubSkillPath(cfg.HubPath, leafSkillID(action.SkillID))
		if err != nil {
			return err
		}
		return execMoveToHub(action, hubTarget, cfg, tr, cuts)
	case domain.ActionReplaceWithSymlink:
		hubTarget, err := hubSkillPath(cfg.HubPath, action.SkillID)
		if err != nil {
			return err
		}
		hub := existingHubSkillPath(cfg.HubPath, action, hubTarget)
		return execReplaceWithSymlink(action, hub, tr)
	case domain.ActionFixLink:
		hubTarget, err := hubSkillPath(cfg.HubPath, action.SkillID)
		if err != nil {
			return err
		}
		hub := existingHubSkillPath(cfg.HubPath, action, hubTarget)
		return execFixLink(action, hub)
	case domain.ActionMergeConflict:
		hubTarget, err := hubSkillPath(cfg.HubPath, action.SkillID)
		if err != nil {
			return err
		}
		hub := existingHubSkillPath(cfg.HubPath, action, hubTarget)
			return execMergeConflict(action, plan, hub, cfg, tr)
	default:
		return fmt.Errorf("未知动作类型: %s", action.Type)
	}
}

// existingHubSkillPath resolves the real hub skill directory for replace/fix/merge.
// Prefer action.HubPath (filled by BuildPlan) only when it is a skill dir under hub whose
// basename matches the leaf skill id; otherwise scan hub groups by leaf. Fall back to
// default/<leaf> so nested RelSkillIDs share one identity with conflictHubPath.
func existingHubSkillPath(hubRoot string, action domain.OrganizeAction, fallback string) string {
	id := fsutil.NormalizeSkillID(action.SkillID)
	leaf := id
	if i := strings.LastIndex(id, "/"); i >= 0 {
		leaf = id[i+1:]
	}
	if p := strings.TrimSpace(action.HubPath); p != "" {
		abs, err := filepath.Abs(p)
		if err == nil {
			abs = filepath.Clean(abs)
			if (pathInsideDir(abs, hubRoot) || fsutil.SamePath(abs, hubRoot)) &&
				fsutil.IsSkillDir(abs) &&
				strings.EqualFold(filepath.Base(abs), leaf) {
				return abs
			}
		}
		// Untrusted / invalid HubPath: fall through to scan.
	}
	if found, ok := fsutil.FindHubSkillDir(hubRoot, leaf); ok {
		return found
	}
	return fallback
}

func execMoveToHub(action domain.OrganizeAction, hub string, cfg config.Config, tr *trash.Store, cuts *[]cutRecord) error {
	if len(action.Sources) == 0 {
		return fmt.Errorf("move_to_hub 缺少源路径")
	}
	primary := action.Sources[0]
	content, err := resolveMoveContent(primary)
	if err != nil {
		if os.IsNotExist(err) && skillAlreadyInHub(cfg.HubPath, action.SkillID) {
			// 父 skill 已先迁入，嵌套项随父目录进入源仓。
			return nil
		}
		return fmt.Errorf("解析迁入源失败: %w", err)
	}
	if err := movePath(content, hub, tr); err != nil {
		return fmt.Errorf("迁入源仓失败: %w", err)
	}
	// 记录被剪切内容的父目录；FilterSuggestedWorkdirs 会过滤已在 tools / 源仓内的路径。
	if cuts != nil {
		if parent := filepath.Dir(content); parent != "" {
			*cuts = append(*cuts, cutRecord{
				ParentDir: parent,
				SkillID:   leafSkillID(action.SkillID),
			})
		}
	}
	for _, src := range action.Sources {
		if fsutil.SamePath(src, hub) || pathInsideDir(src, hub) {
			// 已在源仓内（含：父 skill 迁入时一并带过来的嵌套 skill）
			continue
		}
		// 外部真实目录已被剪切：不要在原处重建链接。
		if fsutil.SamePath(src, content) && !fsutil.SamePath(src, action.Sources[0]) {
			continue
		}
		// 深度扫描 orphan / 非工具目录：只剪切迁入，不在原路径建 symlink（否则还会被再次扫到）。
		if !sourceNeedsToolRelink(src, cfg) {
			continue
		}
		if err := ensureLinkedToHub(src, hub, tr); err != nil {
			return err
		}
	}
	return nil
}

func leafSkillID(skillID string) string {
	id := fsutil.NormalizeSkillID(skillID)
	if i := strings.LastIndex(id, "/"); i >= 0 {
		return id[i+1:]
	}
	return id
}

// skillAlreadyInHub reports whether this skill id is already a skill directory
// under the hub (including nested ids such as parent/examples/child that landed
// inside a parent that was moved first).
func skillAlreadyInHub(hubRoot, skillID string) bool {
	id := fsutil.NormalizeSkillID(skillID)
	if id == "" || hubRoot == "" {
		return false
	}
	parts := strings.Split(id, "/")
	cand := filepath.Join(append([]string{hubRoot, domain.DefaultGroup}, parts...)...)
	if fsutil.IsSkillDir(cand) {
		return true
	}
	if len(parts) == 1 {
		_, ok := fsutil.FindHubSkillDir(hubRoot, id)
		return ok
	}
	ents, err := os.ReadDir(hubRoot)
	if err != nil {
		return false
	}
	for _, e := range ents {
		if !e.IsDir() || fsutil.ShouldSkipDir(e.Name()) {
			continue
		}
		nested := filepath.Join(append([]string{hubRoot, e.Name()}, parts...)...)
		if fsutil.IsSkillDir(nested) {
			return true
		}
	}
	return false
}

// sourceNeedsToolRelink reports whether src lives under an enabled tool skills root
// and should be replaced with a symlink after move_to_hub.
// 不用 EvalSymlinks：源路径迁走后在 Windows 上 Abs(短路径) 与 EvalSymlinks(长路径)
// 不一致会导致误判为「不在工具目录内」。
func sourceNeedsToolRelink(src string, cfg config.Config) bool {
	clean := absCleanNoEval(src)
	for _, t := range cfg.Tools {
		if !t.Enabled || t.Path == "" || t.IsHub {
			continue
		}
		root := absCleanNoEval(t.Path)
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

func absCleanNoEval(p string) string {
	if p == "" {
		return ""
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return filepath.Clean(p)
	}
	return filepath.Clean(abs)
}

// resolveMoveContent returns the real directory to cut into hub.
// If src is a symlink (tool-side link to an external skill), its target is cut.
func resolveMoveContent(src string) (string, error) {
	fi, err := os.Lstat(src)
	if err != nil {
		return "", err
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		return src, nil
	}
	return absLinkTarget(src)
}

func absLinkTarget(linkPath string) (string, error) {
	target, err := os.Readlink(linkPath)
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(target) {
		target = filepath.Join(filepath.Dir(linkPath), target)
	}
	abs, err := filepath.Abs(target)
	if err != nil {
		return filepath.Clean(target), nil
	}
	return abs, nil
}

func ensureLinkedToHub(src, hub string, tr *trash.Store) error {
	fi, err := os.Lstat(src)
	if err != nil {
		if os.IsNotExist(err) {
			if err := linker.EnsureSymlink(src, hub); err != nil {
				return fmt.Errorf("创建符号链接失败 %s: %w", src, err)
			}
			return nil
		}
		return err
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		if err := linker.EnsureSymlink(src, hub); err != nil {
			return fmt.Errorf("修复符号链接失败 %s: %w", src, err)
		}
		return nil
	}
	return trashThenLink(src, hub, tr)
}

func execReplaceWithSymlink(action domain.OrganizeAction, hub string, tr *trash.Store) error {
	for _, src := range action.Sources {
		if fsutil.SamePath(src, hub) {
			continue
		}
		if err := trashThenLink(src, hub, tr); err != nil {
			return err
		}
	}
	return nil
}

func execFixLink(action domain.OrganizeAction, hub string) error {
	for _, src := range action.Sources {
		if fsutil.SamePath(src, hub) {
			continue
		}
		if err := os.Remove(src); err != nil && !os.IsNotExist(err) {
			// broken/wrong symlink: try RemoveSymlink; otherwise surface error
			if err2 := linker.RemoveSymlink(src); err2 != nil {
				return fmt.Errorf("移除旧链接失败 %s: %w", src, err)
			}
		}
		if err := linker.EnsureSymlink(src, hub); err != nil {
			return fmt.Errorf("修复符号链接失败 %s: %w", src, err)
		}
	}
	return nil
}

func execMergeConflict(action domain.OrganizeAction, plan domain.OrganizePlan, hub string, cfg config.Config, tr *trash.Store) error {
	conflict, ok := findConflict(plan, action.SkillID)
	if !ok {
		return fmt.Errorf("未找到技能 %s 的冲突数据", action.SkillID)
	}
	if conflict.Total > 0 && (conflict.Index < conflict.Total || len(conflict.PendingSources) > 0) {
		return fmt.Errorf("技能 %s 还有未完成的合并轮次（冲突 %d/%d），请先应用本轮合并", conflict.SkillID, conflict.Index, conflict.Total)
	}
	if err := ApplyConflictToHub(conflict, hub); err != nil {
		return fmt.Errorf("应用冲突失败: %w", err)
	}

	linkTargets := map[string]struct{}{}
	// Only trash sides that participated in the final round — never unmerged copies.
	for _, side := range []string{conflict.SideA, conflict.SideB} {
		if side == "" || fsutil.SamePath(side, hub) {
			continue
		}
		linkTargets[filepath.Clean(side)] = struct{}{}
		if _, err := os.Lstat(side); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return fmt.Errorf("检查冲突侧失败 %s: %w", side, err)
		}
		if isRealDir(side) {
			if _, err := tr.Move(side); err != nil {
				return fmt.Errorf("移入回收站失败 %s: %w", side, err)
			}
		}
	}
	for _, src := range action.Sources {
		if fsutil.SamePath(src, hub) {
			continue
		}
		linkTargets[filepath.Clean(src)] = struct{}{}
		if _, err := os.Lstat(src); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		if !isRealDir(src) {
			continue
		}
		if fsutil.SamePath(src, conflict.SideA) || fsutil.SamePath(src, conflict.SideB) {
			continue
		}
		if !fsutil.SkillDirsContentDiffer([]string{src, hub}) {
			if _, err := tr.Move(src); err != nil {
				return fmt.Errorf("移入回收站失败 %s: %w", src, err)
			}
			continue
		}
		return fmt.Errorf("拒绝删除未合并的真实副本：%s", src)
	}
		for path := range linkTargets {
			// 深度扫描 orphan / 非工具目录：合并后不在原路径建 symlink（与 move_to_hub 一致）。
			if !sourceNeedsToolRelink(path, cfg) {
				continue
			}
			if err := linker.EnsureSymlink(path, hub); err != nil {
				return fmt.Errorf("创建符号链接失败 %s: %w", path, err)
			}
		}
	return nil
}

func isRealDir(path string) bool {
	fi, err := os.Lstat(path)
	if err != nil {
		return false
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		return false
	}
	return fi.IsDir()
}

func trashThenLink(src, hub string, tr *trash.Store) error {
	if _, err := os.Lstat(src); err != nil {
		if os.IsNotExist(err) {
			return linker.EnsureSymlink(src, hub)
		}
		return err
	}
	if _, err := tr.Move(src); err != nil {
		return fmt.Errorf("移入回收站失败 %s: %w", src, err)
	}
	if err := linker.EnsureSymlink(src, hub); err != nil {
		return fmt.Errorf("创建符号链接失败 %s: %w", src, err)
	}
	return nil
}

func findConflict(plan domain.OrganizePlan, skillID string) (domain.ConflictSkill, bool) {
	for _, c := range plan.Conflicts {
		if c.SkillID == skillID {
			return c, true
		}
	}
	return domain.ConflictSkill{}, false
}

func hubSkillPath(hubRoot, skillID string) (string, error) {
	id := fsutil.NormalizeSkillID(skillID)
	if _, err := fsutil.SplitSkillID(id); err != nil {
		return "", err
	}
	return filepath.Join(hubRoot, domain.DefaultGroup, leafSkillID(id)), nil
}

// movePath renames src to dst; on rename failure (e.g. cross-disk), copies then trashes source.
func movePath(src, dst string, tr *trash.Store) error {
	if fsutil.SamePath(src, dst) || pathInsideDir(src, dst) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	_, dstErr := os.Lstat(dst)
	dstExists := dstErr == nil
	_, srcErr := os.Lstat(src)
	srcMissing := srcErr != nil && os.IsNotExist(srcErr)

	if dstExists {
		// 嵌套 skill：父目录迁入后子路径已在源仓；或源已被父级带走。
		if srcMissing {
			return nil
		}
		if isRealDir(src) && isRealDir(dst) && !fsutil.SkillDirsContentDiffer([]string{src, dst}) {
			// 同内容的第二份 orphan / 副本：源仓已有，剪切掉残留，避免报告成功却留在盘上。
			if _, err := tr.Move(src); err != nil {
				return fmt.Errorf("移入回收站失败 %s: %w", src, err)
			}
			return nil
		}
		if !isRealDir(src) {
			return nil
		}
		return fmt.Errorf("目标已存在: %s", dst)
	}
	if srcMissing {
		return fmt.Errorf("源路径不存在: %s", src)
	}
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	if err := fsutil.CopyTree(src, dst); err != nil {
		_ = os.RemoveAll(dst)
		return fmt.Errorf("跨盘复制失败: %w", err)
	}
	if _, err := tr.Move(src); err != nil {
		return fmt.Errorf("跨盘复制后清理源失败: %w", err)
	}
	return nil
}

// pathInsideDir reports whether path is dest or resolves inside dest (symlink-aware).
func pathInsideDir(path, dest string) bool {
	if path == "" || dest == "" {
		return false
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	absDest, err := filepath.Abs(dest)
	if err != nil {
		return false
	}
	realPath, err := filepath.EvalSymlinks(absPath)
	if err != nil {
		realPath = absPath
	}
	realDest, err := filepath.EvalSymlinks(absDest)
	if err != nil {
		realDest = absDest
	}
	realPath = filepath.Clean(realPath)
	realDest = filepath.Clean(realDest)
	if fsutil.SamePath(realPath, realDest) {
		return true
	}
	rel, err := filepath.Rel(realDest, realPath)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
