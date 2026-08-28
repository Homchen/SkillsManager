package workdir

import (
	"os"
	"path/filepath"
	"strings"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
	"SkillsManager/internal/linker"
)

// ConfirmAdd appends selected suggested workdirs to cfg.Tools and ensures
// skill symlinks under each path. It does not Save config.
func ConfirmAdd(cfg *config.Config, suggestions []domain.SuggestedWorkdir, paths []string, hubRoot string) (domain.AddWorkdirsResult, error) {
	var res domain.AddWorkdirsResult
	if len(paths) == 0 {
		return res, nil
	}

	for _, path := range paths {
		sug, ok := findSuggestion(suggestions, path)
		if !ok {
			res.Skipped = append(res.Skipped, domain.ReportItem{
				Message: "不在建议列表中",
			})
			continue
		}

		if toolPathExists(cfg.Tools, sug.Path) {
			res.Skipped = append(res.Skipped, domain.ReportItem{
				Message: "已是工作目录",
			})
			continue
		}

		fi, err := os.Stat(sug.Path)
		if err != nil || !fi.IsDir() {
			res.Skipped = append(res.Skipped, domain.ReportItem{
				Message: "不是目录",
			})
			continue
		}

		id := config.SuggestToolID(sug.Path, cfg.Tools)
		cfg.Tools = append(cfg.Tools, config.ToolMapping{
			ID:      id,
			Path:    sug.Path,
			Enabled: true,
		})
		res.Added = append(res.Added, domain.ReportItem{
			SkillID: id,
			Message: sug.Path,
		})

		for _, skillID := range sug.SkillIDs {
			linkOne(&res, sug.Path, hubRoot, skillID)
		}
	}
	return res, nil
}

func linkOne(res *domain.AddWorkdirsResult, workdirPath, hubRoot, skillID string) {
	linkPath := skillPath(workdirPath, skillID)
	hubPath, ok := fsutil.FindHubSkillDir(hubRoot, skillID)
	if !ok {
		res.Failed = append(res.Failed, domain.ReportItem{
			SkillID: skillID,
			Message: "源仓中未找到 skill",
		})
		return
	}

	if fi, err := os.Lstat(linkPath); err == nil {
		if fi.Mode()&os.ModeSymlink == 0 {
			res.Skipped = append(res.Skipped, domain.ReportItem{
				SkillID: skillID,
				Message: "目标已是真实目录",
			})
			return
		}
	}

	if err := linker.EnsureSymlink(linkPath, hubPath); err != nil {
		if strings.Contains(err.Error(), "不是符号链接") {
			res.Skipped = append(res.Skipped, domain.ReportItem{
				SkillID: skillID,
				Message: "目标已是真实目录",
			})
			return
		}
		res.Failed = append(res.Failed, domain.ReportItem{
			SkillID: skillID,
			Message: err.Error(),
		})
		return
	}
	res.Linked = append(res.Linked, domain.ReportItem{
		SkillID: skillID,
		Message: linkPath,
	})
}

func findSuggestion(suggestions []domain.SuggestedWorkdir, path string) (domain.SuggestedWorkdir, bool) {
	for _, s := range suggestions {
		if fsutil.SamePath(s.Path, path) {
			return s, true
		}
	}
	return domain.SuggestedWorkdir{}, false
}

func toolPathExists(tools []config.ToolMapping, path string) bool {
	for _, t := range tools {
		if t.Path != "" && fsutil.SamePath(t.Path, path) {
			return true
		}
	}
	return false
}

// skillPath builds a tool-side skill directory: <toolRoot>/<skillID>.
func skillPath(root, skillID string) string {
	return filepath.Join(root, fsutil.NormalizeSkillID(skillID))
}
