package organizer

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
)

func validateOrganizePlan(plan domain.OrganizePlan, cfg config.Config, extras []domain.SkillEntry) error {
	roots := allowedRoots(cfg, extras)
	check := func(p string) error {
		if p == "" {
			return nil
		}
		if !planPathUnderAnyRoot(p, roots) {
			return fmt.Errorf("整理计划包含越界路径：%s", p)
		}
		return nil
	}
	checkSkillID := func(id string) error {
		if _, err := fsutil.SplitSkillID(id); err != nil {
			return fmt.Errorf("整理计划 skill id 非法：%s", id)
		}
		return nil
	}
	for _, action := range plan.Actions {
		if err := checkSkillID(action.SkillID); err != nil {
			return err
		}
		if err := check(action.HubPath); err != nil {
			return err
		}
		for _, src := range action.Sources {
			if err := check(src); err != nil {
				return err
			}
		}
	}
	for _, c := range plan.Conflicts {
		if err := checkSkillID(c.SkillID); err != nil {
			return err
		}
		if err := check(c.SideA); err != nil {
			return err
		}
		if err := check(c.SideB); err != nil {
			return err
		}
		for _, p := range c.PendingSources {
			if err := check(p); err != nil {
				return err
			}
		}
		for _, f := range c.Files {
			rel := strings.TrimSpace(f.RelativePath)
			if rel == "" {
				continue
			}
			slash := filepath.ToSlash(rel)
			if filepath.IsAbs(rel) || strings.Contains(slash, "..") {
				return fmt.Errorf("整理计划包含越界相对路径：%s", f.RelativePath)
			}
		}
	}
	return nil
}

func allowedRoots(cfg config.Config, extras []domain.SkillEntry) []string {
	roots := []string{cfg.HubPath}
	for _, t := range cfg.Tools {
		if !t.Enabled || t.Path == "" {
			continue
		}
		roots = append(roots, t.Path)
	}
	for _, e := range extras {
		for _, loc := range e.Locations {
			if loc.Path != "" {
				roots = append(roots, loc.Path)
			}
		}
	}
	return roots
}

func planPathUnderAnyRoot(path string, roots []string) bool {
	if path == "" {
		return false
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	abs = filepath.Clean(abs)
	absFold := strings.ToLower(abs)
	sep := string(os.PathSeparator)
	for _, root := range roots {
		if root == "" {
			continue
		}
		r, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		r = filepath.Clean(r)
		rFold := strings.ToLower(r)
		if absFold == rFold || strings.HasPrefix(absFold, rFold+sep) {
			return true
		}
	}
	return false
}
