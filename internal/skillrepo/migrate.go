package skillrepo

import (
	"fmt"
	"os"
	"path/filepath"

	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
)

func (r *Repo) ListRootSkillIDs() ([]string, error) {
	ents, err := os.ReadDir(r.Hub)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var ids []string
	for _, e := range ents {
		if !e.IsDir() || fsutil.ShouldSkipDir(e.Name()) {
			continue
		}
		src := filepath.Join(r.Hub, e.Name())
		if fsutil.IsSkillDir(src) {
			ids = append(ids, e.Name())
		}
	}
	return ids, nil
}

// MigrateRootSkillToDefault moves hub/<id> to hub/default/<id>.
// If default/<id> already exists, the leftover is renamed into
// default/<id>-orphan (or -<n>) so both skills stay visible.
// destID is the leaf name under default/; moved is false when src is not a root skill.
func (r *Repo) MigrateRootSkillToDefault(id string) (destID string, moved bool, err error) {
	src := filepath.Join(r.Hub, id)
	if !fsutil.IsSkillDir(src) {
		return "", false, nil
	}
	if err := os.MkdirAll(filepath.Join(r.Hub, domain.DefaultGroup), 0o755); err != nil {
		return "", false, err
	}
	destID = id
	dst := filepath.Join(r.Hub, domain.DefaultGroup, destID)
	if _, err := os.Stat(dst); err == nil {
		destID, err = r.uniqueDefaultLeaf(id+"-orphan", src)
		if err != nil {
			return "", false, err
		}
		dst = filepath.Join(r.Hub, domain.DefaultGroup, destID)
	} else if err != nil && !os.IsNotExist(err) {
		return "", false, err
	}
	if err := os.Rename(src, dst); err != nil {
		return "", false, err
	}
	return destID, true, nil
}

func (r *Repo) uniqueDefaultLeaf(base, exceptSrc string) (string, error) {
	if err := validateLeafID(base); err != nil {
		return "", err
	}
	exceptAbs, _ := filepath.Abs(exceptSrc)
	for n := 1; n <= 10000; n++ {
		cand := base
		if n > 1 {
			cand = fmt.Sprintf("%s-%d", base, n)
		}
		if r.leafTaken(cand, exceptAbs) {
			continue
		}
		return cand, nil
	}
	return "", fmt.Errorf("无法为根 skill 分配唯一 id: %s", base)
}

func (r *Repo) leafTaken(id, exceptAbs string) bool {
	rootCand := filepath.Join(r.Hub, id)
	if fsutil.IsSkillDir(rootCand) {
		if abs, err := filepath.Abs(rootCand); err == nil && exceptAbs != "" && fsutil.SamePath(abs, exceptAbs) {
			return false
		}
		return true
	}
	_, found, err := r.Find(id)
	if err != nil {
		return false
	}
	if exceptAbs != "" && fsutil.SamePath(found, exceptAbs) {
		return false
	}
	return true
}

func (r *Repo) MigrateRootSkillsToDefault() (moved, skipped []string, err error) {
	if err := os.MkdirAll(filepath.Join(r.Hub, domain.DefaultGroup), 0o755); err != nil {
		return nil, nil, err
	}
	ids, err := r.ListRootSkillIDs()
	if err != nil {
		return nil, nil, err
	}
	for _, id := range ids {
		destID, ok, err := r.MigrateRootSkillToDefault(id)
		if err != nil {
			skipped = append(skipped, id)
			continue
		}
		if !ok {
			skipped = append(skipped, id)
			continue
		}
		moved = append(moved, destID)
	}
	return moved, skipped, nil
}
