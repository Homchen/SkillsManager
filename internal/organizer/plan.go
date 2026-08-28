package organizer

import (
	"fmt"
	"os"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
)

// BuildPlan builds an organize preview from scanned skill entries.
func BuildPlan(entries []domain.SkillEntry, cfg config.Config) (domain.OrganizePlan, error) {
	_ = cfg
	plan := domain.OrganizePlan{
		Actions: make([]domain.OrganizeAction, 0, len(entries)),
	}
	for _, e := range entries {
		action, conflict, err := planForEntry(e)
		if err != nil {
			return domain.OrganizePlan{}, err
		}
		plan.Actions = append(plan.Actions, action)
		if conflict != nil {
			plan.Conflicts = append(plan.Conflicts, *conflict)
		}
	}
	return plan, nil
}

func planForEntry(e domain.SkillEntry) (domain.OrganizeAction, *domain.ConflictSkill, error) {
	hub := e.HubPath
	var reals, broken, symlinks []domain.SkillLocation
	for _, loc := range e.Locations {
		switch loc.Kind {
		case domain.KindHub:
			if hub == "" {
				hub = loc.Path
			}
		case domain.KindRealCopy:
			reals = append(reals, loc)
		case domain.KindBrokenLink:
			broken = append(broken, loc)
		case domain.KindSymlink:
			symlinks = append(symlinks, loc)
		}
	}
	// 源仓路径已记录但不存在时，按「无源仓」处理，避免 Walk 冒出英文系统错误。
	if hub != "" {
		if st, err := os.Stat(hub); err != nil || !st.IsDir() {
			hub = ""
		}
	}

	action := domain.OrganizeAction{
		SkillID:  e.ID,
		Selected: defaultSelected(e),
		HubPath:  hub,
	}

	wrongLinks := externalSymlinks(hub, symlinks)

	if hub != "" {
		diffReals := differingReals(hub, reals)
		if len(diffReals) > 0 {
			pending := sourcePaths(diffReals[1:])
			conflict, err := buildEntryConflict(e.ID, hub, diffReals[0].Path, len(diffReals), pending)
			if err != nil {
				return domain.OrganizeAction{}, nil, err
			}
			action.Type = domain.ActionMergeConflict
			action.Sources = append([]string{hub}, sourcePaths(diffReals)...)
			action.Sources = append(action.Sources, sourcePaths(sameReals(hub, reals))...)
			action.Sources = append(action.Sources, sourcePaths(broken)...)
			action.Sources = append(action.Sources, sourcePaths(wrongLinks)...)
			return action, conflict, nil
		}
		if len(reals) > 0 {
			action.Type = domain.ActionReplaceWithSymlink
			action.Sources = append(sourcePaths(reals), sourcePaths(broken)...)
			action.Sources = append(action.Sources, sourcePaths(wrongLinks)...)
			return action, nil, nil
		}
		if len(broken) > 0 || len(wrongLinks) > 0 {
			action.Type = domain.ActionFixLink
			action.Sources = append(sourcePaths(broken), sourcePaths(wrongLinks)...)
			return action, nil, nil
		}
		action.Type = domain.ActionSkip
		return action, nil, nil
	}

	contentRoots := contentRootsForMove(reals, wrongLinks)
	toolSources := append(sourcePaths(reals), sourcePaths(wrongLinks)...)

	if len(contentRoots) == 0 {
		action.Type = domain.ActionSkip
		action.Sources = sourcePaths(broken)
		return action, nil, nil
	}
	if len(contentRoots) == 1 {
		action.Type = domain.ActionMoveToHub
		action.Sources = toolSources
		return action, nil, nil
	}

	if fsutil.SkillDirsContentDiffer(contentRoots) {
		pending := contentRoots[2:]
		conflict, err := buildEntryConflict(e.ID, contentRoots[0], contentRoots[1], len(contentRoots)-1, pending)
		if err != nil {
			return domain.OrganizeAction{}, nil, err
		}
		action.Type = domain.ActionMergeConflict
		action.Sources = toolSources
		return action, conflict, nil
	}
	action.Type = domain.ActionMoveToHub
	action.Sources = toolSources
	return action, nil, nil
}

// externalSymlinks returns symlinks whose target is missing/empty or not the hub skill dir.
func externalSymlinks(hub string, links []domain.SkillLocation) []domain.SkillLocation {
	var out []domain.SkillLocation
	for _, loc := range links {
		if hub != "" && loc.LinkTarget != "" && fsutil.SamePath(loc.LinkTarget, hub) {
			continue
		}
		out = append(out, loc)
	}
	return out
}

// contentRootsForMove collects unique real directories to cut into hub: real_copy paths and symlink targets.
func contentRootsForMove(reals, externalLinks []domain.SkillLocation) []string {
	var roots []string
	for _, loc := range reals {
		if !containsPath(roots, loc.Path) {
			roots = append(roots, loc.Path)
		}
	}
	for _, loc := range externalLinks {
		if loc.LinkTarget == "" {
			continue
		}
		if !containsPath(roots, loc.LinkTarget) {
			roots = append(roots, loc.LinkTarget)
		}
	}
	return roots
}

func containsPath(paths []string, p string) bool {
	for _, x := range paths {
		if fsutil.SamePath(x, p) {
			return true
		}
	}
	return false
}

func buildEntryConflict(skillID, sideA, sideB string, total int, pending []string) (*domain.ConflictSkill, error) {
	c, err := BuildConflict(sideA, sideB)
	if err != nil {
		return nil, fmt.Errorf("构建技能 %s 的冲突失败：%w", skillID, err)
	}
	c.SkillID = skillID
	c.Index = 1
	if total < 1 {
		total = 1
	}
	c.Total = total
	c.PendingSources = append([]string(nil), pending...)
	return &c, nil
}

func differingReals(hub string, reals []domain.SkillLocation) []domain.SkillLocation {
	var out []domain.SkillLocation
	for _, loc := range reals {
		if fsutil.SkillDirsContentDiffer([]string{hub, loc.Path}) {
			out = append(out, loc)
		}
	}
	return out
}

func sameReals(hub string, reals []domain.SkillLocation) []domain.SkillLocation {
	var out []domain.SkillLocation
	for _, loc := range reals {
		if !fsutil.SkillDirsContentDiffer([]string{hub, loc.Path}) {
			out = append(out, loc)
		}
	}
	return out
}

func sourcePaths(locs []domain.SkillLocation) []string {
	out := make([]string, 0, len(locs))
	for _, loc := range locs {
		out = append(out, loc.Path)
	}
	return out
}

func defaultSelected(e domain.SkillEntry) bool {
	hasOrphan := false
	hasConfigured := false
	for _, loc := range e.Locations {
		if loc.Kind == domain.KindHub {
			continue
		}
		if loc.ToolID == "orphan" {
			hasOrphan = true
			continue
		}
		hasConfigured = true
	}
	if hasOrphan && !hasConfigured {
		return false
	}
	return true
}
