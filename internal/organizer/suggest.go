package organizer

import (
	"path/filepath"
	"sort"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
)

type cutRecord struct {
	ParentDir string
	SkillID   string
}

func FilterSuggestedWorkdirs(cuts []cutRecord, cfg config.Config) []domain.SuggestedWorkdir {
	type bucket struct {
		path     string
		skillIDs []string
	}
	byPath := make(map[string]*bucket)
	order := make([]string, 0)

	for _, cut := range cuts {
		if cut.ParentDir == "" {
			continue
		}
		parent := filepath.Clean(cut.ParentDir)
		if abs, err := filepath.Abs(cut.ParentDir); err == nil {
			parent = filepath.Clean(abs)
		}

		if cfg.HubPath != "" && (fsutil.SamePath(parent, cfg.HubPath) || pathInsideDir(parent, cfg.HubPath)) {
			continue
		}
		skip := false
		for _, tool := range cfg.Tools {
			if tool.Path != "" && fsutil.SamePath(tool.Path, parent) {
				skip = true
				break
			}
		}
		if skip {
			continue
		}

		b, ok := byPath[parent]
		if !ok {
			b = &bucket{path: parent}
			byPath[parent] = b
			order = append(order, parent)
		}
		if cut.SkillID != "" {
			b.skillIDs = append(b.skillIDs, cut.SkillID)
		}
	}

	sort.Strings(order)
	out := make([]domain.SuggestedWorkdir, 0, len(order))
	for _, key := range order {
		b := byPath[key]
		out = append(out, domain.SuggestedWorkdir{
			Path:       b.path,
			SkillIDs:   b.skillIDs,
			SkillCount: len(b.skillIDs),
		})
	}
	return out
}
