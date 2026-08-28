package skillrepo

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
)

func (r *Repo) ListGroups() ([]domain.GroupInfo, error) {
	if err := os.MkdirAll(filepath.Join(r.Hub, domain.DefaultGroup), 0o755); err != nil {
		return nil, err
	}
	ents, err := os.ReadDir(r.Hub)
	if err != nil {
		return nil, err
	}
	var out []domain.GroupInfo
	for _, e := range ents {
		if !e.IsDir() || fsutil.ShouldSkipDir(e.Name()) {
			continue
		}
		// 跳过根下残留的「像 skill」目录（迁移前）；迁移后不应出现
		if fsutil.IsSkillDir(filepath.Join(r.Hub, e.Name())) {
			continue
		}
		out = append(out, domain.GroupInfo{ID: e.Name()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (r *Repo) CreateGroup(name string) error {
	if err := ValidateGroupName(name); err != nil {
		return err
	}
	dir := filepath.Join(r.Hub, strings.TrimSpace(name))
	if _, err := os.Stat(dir); err == nil {
		return fmt.Errorf("分组已存在: %s", name)
	}
	return os.MkdirAll(dir, 0o755)
}

func (r *Repo) RenameGroup(oldName, newName string) error {
	oldName = strings.TrimSpace(oldName)
	if strings.EqualFold(oldName, domain.DefaultGroup) {
		return fmt.Errorf("不能重命名保留分组 default")
	}
	if err := ValidateGroupName(oldName); err != nil {
		return err
	}
	if err := ValidateGroupName(newName); err != nil {
		return err
	}
	newName = strings.TrimSpace(newName)
	if oldName == newName {
		return nil
	}
	src := filepath.Join(r.Hub, oldName)
	if _, err := os.Stat(src); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("分组不存在: %s", oldName)
		}
		return err
	}
	dst := filepath.Join(r.Hub, newName)
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("分组已存在: %s", newName)
	}
	return os.Rename(src, dst)
}

func (r *Repo) DeleteGroup(name string) error {
	name = strings.TrimSpace(name)
	if strings.EqualFold(name, domain.DefaultGroup) {
		return fmt.Errorf("不能删除保留分组 default")
	}
	if err := ValidateGroupName(name); err != nil {
		return err
	}
	dir := filepath.Join(r.Hub, name)
	if _, err := os.Stat(dir); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("分组不存在: %s", name)
		}
		return err
	}
	ents, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		cand := filepath.Join(dir, e.Name())
		if !fsutil.IsSkillDir(cand) {
			continue
		}
		if err := r.SetSkillGroup(e.Name(), domain.DefaultGroup); err != nil {
			return err
		}
	}
	return os.Remove(dir)
}

func (r *Repo) SetSkillGroup(id, group string) error {
	group = normalizeGroup(group)
	if group != domain.DefaultGroup {
		if err := ValidateGroupName(group); err != nil {
			return err
		}
	}
	curGroup, src, err := r.Find(id)
	if err != nil {
		return err
	}
	if curGroup == group {
		return nil
	}
	dst := r.SkillPath(group, id)
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("目标分组已存在同名 skill: %s", id)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.Rename(src, dst)
}
