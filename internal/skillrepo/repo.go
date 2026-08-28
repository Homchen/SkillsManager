package skillrepo

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
	"SkillsManager/internal/trash"
)

type Repo struct {
	Hub   string
	Trash *trash.Store
}

func New(hub string, tr *trash.Store) *Repo {
	return &Repo{Hub: hub, Trash: tr}
}

func ValidateGroupName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("分组名不能为空")
	}
	if strings.EqualFold(name, domain.DefaultGroup) {
		return fmt.Errorf("不能使用保留分组名 default")
	}
	if strings.ContainsAny(name, `/\`) || name == "." || name == ".." || strings.Contains(name, "..") {
		return fmt.Errorf("分组名非法: %s", name)
	}
	return nil
}

func normalizeGroup(group string) string {
	group = strings.TrimSpace(group)
	if group == "" {
		return domain.DefaultGroup
	}
	return group
}

func (r *Repo) SkillPath(group, id string) string {
	return filepath.Join(r.Hub, normalizeGroup(group), fsutil.NormalizeSkillID(id))
}

func (r *Repo) Find(id string) (string, string, error) {
	id = fsutil.NormalizeSkillID(id)
	if id == "" || strings.Contains(id, "/") {
		return "", "", fmt.Errorf("skill id 非法: %s", id)
	}
	if fsutil.ShouldSkipDir(id) {
		return "", "", fmt.Errorf("未找到 skill: %s", id)
	}
	ents, err := os.ReadDir(r.Hub)
	if err != nil {
		return "", "", err
	}
	for _, e := range ents {
		if !e.IsDir() || fsutil.ShouldSkipDir(e.Name()) {
			continue
		}
		cand := filepath.Join(r.Hub, e.Name(), id)
		if fsutil.IsSkillDir(cand) {
			return e.Name(), cand, nil
		}
	}
	return "", "", fmt.Errorf("未找到 skill: %s", id)
}

func (r *Repo) Create(id, name, group string) error {
	if err := validateLeafID(id); err != nil {
		return err
	}
	group = normalizeGroup(group)
	if group != domain.DefaultGroup {
		if err := ValidateGroupName(group); err != nil {
			return err
		}
	}
	if _, _, err := r.Find(id); err == nil {
		return fmt.Errorf("skill 已存在: %s", id)
	}
	dir := r.SkillPath(group, id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	body := fmt.Sprintf("---\nname: %s\ndescription: \n---\n\n# %s\n", name, name)
	return os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o644)
}

func (r *Repo) Rename(oldID, newID string) error {
	if err := validateLeafID(newID); err != nil {
		return err
	}
	group, src, err := r.Find(oldID)
	if err != nil {
		return err
	}
	if _, _, err := r.Find(newID); err == nil {
		return fmt.Errorf("skill 已存在: %s", newID)
	}
	dst := r.SkillPath(group, newID)
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.Rename(src, dst)
}

func (r *Repo) Delete(id string) error {
	_, abs, err := r.Find(id)
	if err != nil {
		return err
	}
	_, err = r.Trash.Move(abs)
	return err
}

func (r *Repo) ListFiles(id string) ([]string, error) {
	_, root, err := r.Find(id)
	if err != nil {
		return nil, err
	}
	var out []string
	err = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if path != root && fsutil.ShouldSkipDir(d.Name()) {
				return filepath.SkipDir
			}
			if path == root {
				return nil
			}
			ents, readErr := os.ReadDir(path)
			if readErr != nil {
				return readErr
			}
			if len(ents) == 0 {
				rel, relErr := filepath.Rel(root, path)
				if relErr != nil {
					return relErr
				}
				out = append(out, filepath.ToSlash(rel)+"/")
			}
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		out = append(out, filepath.ToSlash(rel))
		return nil
	})
	return out, err
}

func normalizeRelPath(rel string) (string, error) {
	rel = filepath.ToSlash(strings.TrimSpace(rel))
	rel = strings.Trim(rel, "/")
	if rel == "" {
		return "", fmt.Errorf("路径不能为空")
	}
	for _, part := range strings.Split(rel, "/") {
		if part == "" || part == "." || part == ".." {
			return "", fmt.Errorf("路径非法: %s", rel)
		}
	}
	return rel, nil
}

// isRootSkillDefinition reports whether rel is the skill-identifying SKILL.md at the skill root.
func isRootSkillDefinition(rel string) bool {
	return filepath.ToSlash(strings.Trim(rel, "/")) == "SKILL.md"
}

// CreateFile creates an empty text file under a hub skill. Fails if the path already exists.
func (r *Repo) CreateFile(id, rel string) error {
	rel, err := normalizeRelPath(rel)
	if err != nil {
		return err
	}
	abs, err := r.resolveUnderHub(id, rel)
	if err != nil {
		return err
	}
	if _, err := os.Stat(abs); err == nil {
		return fmt.Errorf("已存在: %s", rel)
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(abs, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	return f.Close()
}

// Mkdir creates a directory under a hub skill (including parents). Fails if the path already exists.
func (r *Repo) Mkdir(id, rel string) error {
	rel, err := normalizeRelPath(rel)
	if err != nil {
		return err
	}
	abs, err := r.resolveUnderHub(id, rel)
	if err != nil {
		return err
	}
	if st, err := os.Stat(abs); err == nil {
		if st.IsDir() {
			return fmt.Errorf("目录已存在: %s", rel)
		}
		return fmt.Errorf("已存在同名文件: %s", rel)
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.MkdirAll(abs, 0o755)
}

// RenameEntry renames a file or directory under a hub skill without overwriting.
func (r *Repo) RenameEntry(id, oldRel, newRel string) error {
	oldRel, err := normalizeRelPath(oldRel)
	if err != nil {
		return err
	}
	newRel, err = normalizeRelPath(newRel)
	if err != nil {
		return err
	}
	if isRootSkillDefinition(oldRel) {
		return fmt.Errorf("不能重命名技能根目录的 SKILL.md")
	}
	if oldRel == newRel {
		return nil
	}
	src, err := r.resolveUnderHub(id, oldRel)
	if err != nil {
		return err
	}
	if _, err := os.Stat(src); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("未找到: %s", oldRel)
		}
		return err
	}
	dst, err := r.resolveUnderHub(id, newRel)
	if err != nil {
		return err
	}
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("已存在: %s", newRel)
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.Rename(src, dst)
}

// DeleteEntry permanently removes a file or directory under a hub skill.
func (r *Repo) DeleteEntry(id, rel string) error {
	rel, err := normalizeRelPath(rel)
	if err != nil {
		return err
	}
	if isRootSkillDefinition(rel) {
		return fmt.Errorf("不能删除技能根目录的 SKILL.md")
	}
	abs, err := r.resolveUnderHub(id, rel)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(abs); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("未找到: %s", rel)
		}
		return err
	}
	return os.RemoveAll(abs)
}

func (r *Repo) ReadFile(id, rel string) (string, error) {
	abs, err := r.resolveUnderHub(id, rel)
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (r *Repo) WriteFile(id, rel, content string) error {
	abs, err := r.resolveUnderHub(id, rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	return os.WriteFile(abs, []byte(content), 0o644)
}

func validateLeafID(id string) error {
	id = fsutil.NormalizeSkillID(id)
	if id == "" {
		return fmt.Errorf("skill id 不能为空")
	}
	if strings.Contains(id, "/") {
		return fmt.Errorf("skill id 非法: %s", id)
	}
	if id == ".." || id == "." || strings.Contains(id, "..") {
		return fmt.Errorf("skill id 非法: %s", id)
	}
	if fsutil.ShouldSkipDir(id) {
		return fmt.Errorf("skill id 保留名不可用: %s", id)
	}
	return nil
}

// ValidateSkillID checks whether id can be used as a single skill directory.
func ValidateSkillID(id string) error {
	return validateLeafID(id)
}

func (r *Repo) resolveUnderHub(id, rel string) (string, error) {
	_, skillAbs, err := r.Find(id)
	if err != nil {
		return "", err
	}
	return fsutil.SafeJoinUnder(skillAbs, rel)
}
