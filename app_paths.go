package main

import (
	"fmt"
	"os"
	"path/filepath"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
	"SkillsManager/internal/linker"
	"SkillsManager/internal/skillrepo"
	"SkillsManager/internal/trash"
)

func (a *appCore) purgeTrash() {
	if a.cfg.HubPath == "" {
		return
	}
	_ = trash.New(a.cfg.HubPath).PurgeOlderThan(a.cfg.TrashRetentionDays)
}

func toolSkillPath(toolRoot, skillID string) string {
	return filepath.Join(toolRoot, fsutil.NormalizeSkillID(skillID))
}

func isNeedAdminErr(err error) bool {
	return err != nil && (err.Error() == errNeedAdmin)
}

// migrateRootSkillsAndRelink moves hub-root skills into default/.
// Skills with tool symlinks are not renamed unless elevated; that case
// returns errNeedAdmin so the caller can surface it without breaking links.
func migrateRootSkillsAndRelink(cfg config.Config, r *skillrepo.Repo, elevated bool) error {
	ids, err := r.ListRootSkillIDs()
	if err != nil {
		return err
	}
	var skippedLinked bool
	for _, id := range ids {
		if !elevated && skillHasToolLinks(cfg, id) {
			skippedLinked = true
			continue
		}
		destID, moved, err := r.MigrateRootSkillToDefault(id)
			if err != nil {
				return err
			}
			if !moved {
				continue
			}
			newPath := filepath.Join(r.Hub, domain.DefaultGroup, destID)
			if destID != id {
				if err := relinkSkillAfterRename(cfg, id, destID, newPath, elevated); err != nil {
					return err
				}
				continue
			}
			if err := relinkSkillHubTarget(cfg, id, newPath, elevated); err != nil {
				return err
			}
	}
	if skippedLinked {
		return fmt.Errorf("%s", errNeedAdmin)
	}
	return nil
}

func unlinkSkillToolLinks(cfg config.Config, skillID string) error {
	id := fsutil.NormalizeSkillID(skillID)
	if id == "" {
		return fmt.Errorf("skill id 不能为空")
	}
	var firstErr error
	for _, tool := range cfg.EnabledNonHubTools() {
		linkPath := toolSkillPath(tool.Path, id)
		if err := linker.RemoveSymlink(linkPath); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("移除工具链接失败 %s: %w", linkPath, err)
		}
	}
	return firstErr
}

func relinkSkillHubTarget(cfg config.Config, skillID, newHubPath string, elevated bool) error {
	id := fsutil.NormalizeSkillID(skillID)
	for _, tool := range cfg.EnabledNonHubTools() {
		link := toolSkillPath(tool.Path, id)
		if !pathIsSymlink(link) {
			continue
		}
		// 非管理员：保留旧链接（移动后会变成 broken_link），提示提权；勿静默删除。
		if !elevated {
			return fmt.Errorf("%s", errNeedAdmin)
		}
		if err := linker.RemoveSymlink(link); err != nil {
			return err
		}
		if err := linker.EnsureSymlink(link, newHubPath); err != nil {
			return err
		}
	}
	return nil
}

func relinkSkillAfterRename(cfg config.Config, oldID, newID, newHubPath string, elevated bool) error {
	oldID = fsutil.NormalizeSkillID(oldID)
	newID = fsutil.NormalizeSkillID(newID)
	for _, tool := range cfg.EnabledNonHubTools() {
		oldLink := toolSkillPath(tool.Path, oldID)
		newLink := toolSkillPath(tool.Path, newID)
		if !pathIsSymlink(oldLink) {
			continue
		}
		// 非管理员：保留旧链接，提示提权；勿静默删除。
		if !elevated {
			return fmt.Errorf("%s", errNeedAdmin)
		}
		if err := linker.RemoveSymlink(oldLink); err != nil {
			return fmt.Errorf("移除旧工具链接失败 %s: %w", oldLink, err)
		}
		if err := linker.EnsureSymlink(newLink, newHubPath); err != nil {
			return fmt.Errorf("创建新工具链接失败 %s: %w", newLink, err)
		}
	}
	return nil
}

func listGroupSkillIDs(hub, group string) ([]string, error) {
	dir := filepath.Join(hub, group)
	ents, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, e := range ents {
		if !e.IsDir() || fsutil.ShouldSkipDir(e.Name()) {
			continue
		}
		cand := filepath.Join(dir, e.Name())
		if fsutil.IsSkillDir(cand) {
			ids = append(ids, e.Name())
		}
	}
	return ids, nil
}

func pathIsSymlink(path string) bool {
	fi, err := os.Lstat(path)
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeSymlink != 0
}

func skillHasToolLinks(cfg config.Config, skillID string) bool {
	id := fsutil.NormalizeSkillID(skillID)
	if id == "" {
		return false
	}
	for _, tool := range cfg.EnabledNonHubTools() {
		if pathIsSymlink(toolSkillPath(tool.Path, id)) {
			return true
		}
	}
	return false
}

func anyGroupSkillHasToolLinks(cfg config.Config, hub, group string) bool {
	ids, err := listGroupSkillIDs(hub, group)
	if err != nil {
		return false
	}
	for _, id := range ids {
		if skillHasToolLinks(cfg, id) {
			return true
		}
	}
	return false
}
