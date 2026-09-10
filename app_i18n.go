package main

import (
	"fmt"
	"os"
	"path/filepath"

	"SkillsManager/internal/fsutil"
	"SkillsManager/internal/skilli18n"
	"SkillsManager/internal/trash"
)

func moveI18nToTrashSidecar(hub, id, skillTrashPath string) error {
	id = fsutil.NormalizeSkillID(id)
	src := skilli18n.New(hub).SkillDir(id)
	if _, err := os.Stat(src); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	tr := trash.New(hub)
	bucket, err := tr.BucketDir(skillTrashPath)
	if err != nil {
		return err
	}
	dest := trash.I18nSidecar(bucket, id)
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	if _, err := os.Stat(dest); err == nil {
		return fmt.Errorf("回收站翻译副本已存在: %s", id)
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(src, dest)
}

func restoreI18nFromTrashSidecar(hub, skillTrashPath, displacedTrashPath string) error {
	id := fsutil.NormalizeSkillID(filepath.Base(skillTrashPath))
	if id == "" {
		return nil
	}
	store := skilli18n.New(hub)
	live := store.SkillDir(id)
	tr := trash.New(hub)
	bucket, err := tr.BucketDir(skillTrashPath)
	if err != nil {
		return err
	}
	sidecar := trash.I18nSidecar(bucket, id)

	if displacedTrashPath != "" {
		if _, err := os.Stat(live); err == nil {
			db, err := tr.BucketDir(displacedTrashPath)
			if err != nil {
				return err
			}
			dest := trash.I18nSidecar(db, id)
			if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
				return err
			}
			if err := os.Rename(live, dest); err != nil {
				return err
			}
		} else if err != nil && !os.IsNotExist(err) {
			return err
		}
	}

	if _, err := os.Stat(sidecar); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if _, err := os.Stat(live); err == nil {
		return fmt.Errorf("翻译仓中已存在 skill：%s", id)
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(live), 0o755); err != nil {
		return err
	}
	return os.Rename(sidecar, live)
}
