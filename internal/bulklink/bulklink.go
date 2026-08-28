package bulklink

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
	"SkillsManager/internal/linker"
)

func Disable(cfg *config.Config, entries []domain.SkillEntry, toolIDs []string) (domain.BulkLinkResult, error) {
	if len(toolIDs) == 0 {
		return domain.BulkLinkResult{}, fmt.Errorf("请至少选择一个工具")
	}
	if cfg.LinkSnapshots == nil {
		cfg.LinkSnapshots = map[string]config.LinkSnapshot{}
	}
	var tools []domain.ToolBulkLinkResult
	for _, tid := range toolIDs {
		tr := domain.ToolBulkLinkResult{ToolID: tid}
		tool, ok := findTool(*cfg, tid)
		if !ok {
			tr.Failed = append(tr.Failed, domain.BulkLinkFailure{Reason: "未找到工具: " + tid})
			tools = append(tools, tr)
			continue
		}
		if tool.IsHub {
			tr.Failed = append(tr.Failed, domain.BulkLinkFailure{Reason: "不能对源仓本身操作"})
			tools = append(tools, tr)
			continue
		}
		if !tool.Enabled {
			tr.Failed = append(tr.Failed, domain.BulkLinkFailure{Reason: "工具未启用: " + tid})
			tools = append(tools, tr)
			continue
		}
		ids, realN := linkableIDsForTool(entries, tid)
		tr.Skipped += realN
		if len(ids) > 0 {
			prev := cfg.LinkSnapshots[tid]
			skillIDs := append([]string(nil), ids...)
			if snapshotCovers(prev.SkillIDs, ids) && len(prev.SkillIDs) > 0 {
				skillIDs = append([]string(nil), prev.SkillIDs...)
			}
			cfg.LinkSnapshots[tid] = config.LinkSnapshot{
				SkillIDs: skillIDs,
				SavedAt:  time.Now().Format(time.RFC3339),
				Count:    len(skillIDs),
			}
		}
		for _, id := range ids {
			p := skillPath(tool.Path, id)
			if err := linker.RemoveSymlink(p); err != nil {
				tr.Failed = append(tr.Failed, domain.BulkLinkFailure{SkillID: id, Path: p, Reason: err.Error()})
				continue
			}
			tr.Removed++
		}
		tools = append(tools, tr)
	}
	return domain.BulkLinkResult{Tools: tools, Totals: sumTotals(tools)}, nil
}

func Enable(cfg *config.Config, entries []domain.SkillEntry, toolIDs []string, mode string) (domain.BulkLinkResult, error) {
	if mode != "all" && mode != "restore" {
		return domain.BulkLinkResult{}, fmt.Errorf("无效的启用模式: %s", mode)
	}
	if len(toolIDs) == 0 {
		return domain.BulkLinkResult{}, fmt.Errorf("请至少选择一个工具")
	}
	var tools []domain.ToolBulkLinkResult
	for _, tid := range toolIDs {
		tr := domain.ToolBulkLinkResult{ToolID: tid}
		tool, ok := findTool(*cfg, tid)
		if !ok {
			tr.Failed = append(tr.Failed, domain.BulkLinkFailure{Reason: "未找到工具: " + tid})
			tools = append(tools, tr)
			continue
		}
		if tool.IsHub {
			tr.Failed = append(tr.Failed, domain.BulkLinkFailure{Reason: "不能对源仓本身操作"})
			tools = append(tools, tr)
			continue
		}
		if !tool.Enabled {
			tr.Failed = append(tr.Failed, domain.BulkLinkFailure{Reason: "工具未启用: " + tid})
			tools = append(tools, tr)
			continue
		}

		var ids []string
		switch mode {
		case "all":
			ids = hubSkillIDs(entries)
		case "restore":
			snap, ok := cfg.LinkSnapshots[tid]
			if !ok || (snap.Count == 0 && len(snap.SkillIDs) == 0) {
				tr.Skipped++
				tools = append(tools, tr)
				continue
			}
			ids = snap.SkillIDs
		}
		for _, id := range ids {
			ensureOne(tool, cfg.HubPath, id, entries, &tr)
		}
		tools = append(tools, tr)
	}
	return domain.BulkLinkResult{Tools: tools, Totals: sumTotals(tools)}, nil
}

func hubSkillIDs(entries []domain.SkillEntry) []string {
	seen := make(map[string]bool)
	var ids []string
	for _, e := range entries {
		hasHub := e.HubPath != ""
		if !hasHub {
			for _, loc := range e.Locations {
				if loc.Kind == domain.KindHub {
					hasHub = true
					break
				}
			}
		}
		if !hasHub || seen[e.ID] {
			continue
		}
		seen[e.ID] = true
		ids = append(ids, e.ID)
	}
	return ids
}

func ensureOne(tool config.ToolMapping, hubRoot, skillID string, entries []domain.SkillEntry, tr *domain.ToolBulkLinkResult) {
	hubPath, ok := resolveHubSkillPath(hubRoot, skillID, entries)
	if !ok {
		tr.Skipped++
		return
	}
	linkPath := skillPath(tool.Path, skillID)
	if _, err := os.Stat(hubPath); err != nil {
		tr.Skipped++
		return
	}
	if fi, err := os.Lstat(linkPath); err == nil {
		if fi.Mode()&os.ModeSymlink != 0 {
			if linker.PointsTo(linkPath, hubPath) {
				tr.Skipped++
				return
			}
		} else {
			tr.Skipped++
			return
		}
	}
	if err := linker.EnsureSymlink(linkPath, hubPath); err != nil {
		tr.Failed = append(tr.Failed, domain.BulkLinkFailure{SkillID: skillID, Path: linkPath, Reason: err.Error()})
		return
	}
	tr.Linked++
}

func snapshotCovers(prev, current []string) bool {
	if len(current) == 0 {
		return true
	}
	set := make(map[string]struct{}, len(prev))
	for _, id := range prev {
		set[id] = struct{}{}
	}
	for _, id := range current {
		if _, ok := set[id]; !ok {
			return false
		}
	}
	return true
}

func findTool(cfg config.Config, id string) (config.ToolMapping, bool) {
	for _, t := range cfg.Tools {
		if t.ID == id {
			return t, true
		}
	}
	return config.ToolMapping{}, false
}

func linkableIDsForTool(entries []domain.SkillEntry, toolID string) (links []string, realCopies int) {
	for _, e := range entries {
		for _, loc := range e.Locations {
			if loc.ToolID != toolID {
				continue
			}
			switch loc.Kind {
			case domain.KindSymlink, domain.KindBrokenLink:
				links = append(links, e.ID)
			case domain.KindRealCopy:
				realCopies++
			}
		}
	}
	return links, realCopies
}

func sumTotals(tools []domain.ToolBulkLinkResult) domain.BulkLinkTotals {
	var t domain.BulkLinkTotals
	for _, tr := range tools {
		t.Linked += tr.Linked
		t.Removed += tr.Removed
		t.Skipped += tr.Skipped
		t.Failed += len(tr.Failed)
	}
	return t
}

// skillPath builds a tool-side skill directory: <toolRoot>/<skillID>.
func skillPath(root, skillID string) string {
	return filepath.Join(root, fsutil.NormalizeSkillID(skillID))
}

func resolveHubSkillPath(hubRoot, skillID string, entries []domain.SkillEntry) (string, bool) {
	id := fsutil.NormalizeSkillID(skillID)
	for _, e := range entries {
		if e.ID != id || strings.TrimSpace(e.HubPath) == "" {
			continue
		}
		if fsutil.IsSkillDir(e.HubPath) {
			return e.HubPath, true
		}
	}
	return fsutil.FindHubSkillDir(hubRoot, id)
}
