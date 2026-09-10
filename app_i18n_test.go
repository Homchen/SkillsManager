package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"SkillsManager/internal/config"
	"SkillsManager/internal/skilli18n"
	"SkillsManager/internal/trash"
)

func newTestApp(t *testing.T) (*appCore, string) {
	t.Helper()
	home := isolateAppHome(t)
	hub := filepath.Join(home, "hub")
	a := newAppCore()
	a.cfg = config.Default()
	a.cfg.HubPath = hub
	a.cfg.Tools = nil
	a.settingsPath = filepath.Join(home, ".skillsmanager", "settings.json")
	return a, hub
}

func addTranslation(t *testing.T, hub, id, lang, body string) {
	t.Helper()
	s := skilli18n.New(hub)
	dir := s.VersionPath(id, lang)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.AddTranslationLanguage(id, lang); err != nil {
		t.Fatal(err)
	}
}

func TestRenameSkillRejectsExistingTranslationDest(t *testing.T) {
	a, hub := newTestApp(t)
	if err := a.CreateSkill("old", "Old", "", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	if err := skilli18n.New(hub).InitDefault("taken", "en"); err != nil {
		t.Fatal(err)
	}
	if err := a.RenameSkill("old", "taken"); err == nil {
		t.Fatal("expected translation dest conflict")
	}
	if _, _, err := a.repo().Find("old"); err != nil {
		t.Fatalf("hub should remain old: %v", err)
	}
	if _, _, err := a.repo().Find("taken"); err == nil {
		t.Fatal("taken hub skill should not exist")
	}
}

func TestRollbackSkillRenameRestoresHub(t *testing.T) {
	a, _ := newTestApp(t)
	if err := a.CreateSkill("old", "Old", "", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	if err := a.repo().Rename("old", "new"); err != nil {
		t.Fatal(err)
	}
	cause := errors.New("i18n rename failed")
	err := a.rollbackSkillRename("old", "new", false, cause)
	if !errors.Is(err, cause) {
		t.Fatalf("err=%v", err)
	}
	if _, _, err := a.repo().Find("old"); err != nil {
		t.Fatalf("hub should roll back to old: %v", err)
	}
	if _, _, err := a.repo().Find("new"); err == nil {
		t.Fatal("new hub skill should be gone")
	}
}

func TestSaveConfigAbortsWhenTranslationRepoExists(t *testing.T) {
	a, hub := newTestApp(t)
	if err := a.CreateSkill("demo", "Demo", "", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	newHub := filepath.Join(filepath.Dir(hub), "other", "skills")
	if err := skilli18n.New(newHub).InitDefault("other", "en"); err != nil {
		t.Fatal(err)
	}
	incoming := a.cfg
	incoming.HubPath = newHub
	if err := a.SaveConfig(incoming); err == nil {
		t.Fatal("expected translation-repo conflict")
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "demo", "SKILL.md")); err != nil {
		t.Fatalf("hub should not have migrated: %v", err)
	}
}

func TestDeleteSkillMovesTranslationsToTrashAndRestore(t *testing.T) {
	a, hub := newTestApp(t)
	if err := a.CreateSkill("demo", "Demo", "", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	addTranslation(t, hub, "demo", "en", "en-body")
	if err := a.DeleteSkill("demo"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(skilli18n.New(hub).SkillDir("demo")); !os.IsNotExist(err) {
		t.Fatal("live translation dir should be gone")
	}
	items, err := a.ListTrash()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("trash items=%d, want 1", len(items))
	}
	if err := a.RestoreTrash(items[0].TrashPath, false); err != nil {
		t.Fatal(err)
	}
	info, err := a.i18n().Info("demo")
	if err != nil {
		t.Fatal(err)
	}
	if info.TranslationCount != 1 {
		t.Fatalf("TranslationCount=%d, want 1", info.TranslationCount)
	}
	b, err := os.ReadFile(filepath.Join(skilli18n.New(hub).VersionPath("demo", "en"), "SKILL.md"))
	if err != nil || string(b) != "en-body" {
		t.Fatalf("restored translation=%q err=%v", b, err)
	}
}

func TestRestoreTrashOverwriteKeepsDisplacedTranslations(t *testing.T) {
	a, hub := newTestApp(t)
	if err := a.CreateSkill("demo", "Demo", "", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	addTranslation(t, hub, "demo", "en", "from-trash")
	if err := a.DeleteSkill("demo"); err != nil {
		t.Fatal(err)
	}
	items, err := a.ListTrash()
	if err != nil || len(items) != 1 {
		t.Fatalf("items=%v err=%v", items, err)
	}
	trashed := items[0].TrashPath
	if err := a.CreateSkill("demo", "Live", "", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	addTranslation(t, hub, "demo", "ja", "live-ja")
	if err := a.RestoreTrash(trashed, true); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(skilli18n.New(hub).VersionPath("demo", "en"), "SKILL.md"))
	if err != nil || string(b) != "from-trash" {
		t.Fatalf("live translations should be restored from trash: %q err=%v", b, err)
	}
	if _, err := os.Stat(skilli18n.New(hub).VersionPath("demo", "ja")); !os.IsNotExist(err) {
		t.Fatal("live ja translation should have been displaced")
	}
	items, err = a.ListTrash()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("displaced skill should be in trash, got %d", len(items))
	}
	bucket, err := trash.New(hub).BucketDir(items[0].TrashPath)
	if err != nil {
		t.Fatal(err)
	}
	b, err = os.ReadFile(filepath.Join(trash.I18nSidecar(bucket, "demo"), "ja", "SKILL.md"))
	if err != nil || string(b) != "live-ja" {
		t.Fatalf("displaced ja translation=%q err=%v", b, err)
	}
}

func TestRollbackSkillRenameRestoresI18n(t *testing.T) {
	a, hub := newTestApp(t)
	if err := a.CreateSkill("old", "Old", "", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	addTranslation(t, hub, "old", "en", "en-body")
	if err := a.repo().Rename("old", "new"); err != nil {
		t.Fatal(err)
	}
	if err := a.i18n().Rename("old", "new"); err != nil {
		t.Fatal(err)
	}
	cause := errors.New("relink failed")
	err := a.rollbackSkillRename("old", "new", true, cause)
	if !errors.Is(err, cause) {
		t.Fatalf("err=%v", err)
	}
	if _, _, err := a.repo().Find("old"); err != nil {
		t.Fatalf("hub should roll back to old: %v", err)
	}
	if _, _, err := a.repo().Find("new"); err == nil {
		t.Fatal("new hub skill should be gone")
	}
	b, err := os.ReadFile(filepath.Join(skilli18n.New(hub).VersionPath("old", "en"), "SKILL.md"))
	if err != nil || string(b) != "en-body" {
		t.Fatalf("i18n should roll back to old: %q err=%v", b, err)
	}
}

func TestRestoreTrashRollsBackWhenLiveTranslationExists(t *testing.T) {
	a, hub := newTestApp(t)
	if err := a.CreateSkill("demo", "Demo", "", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	addTranslation(t, hub, "demo", "en", "en-body")
	if err := a.DeleteSkill("demo"); err != nil {
		t.Fatal(err)
	}
	if err := skilli18n.New(hub).InitDefault("demo", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	items, err := a.ListTrash()
	if err != nil || len(items) != 1 {
		t.Fatalf("items=%v err=%v", items, err)
	}
	if err := a.RestoreTrash(items[0].TrashPath, false); err == nil {
		t.Fatal("expected live translation conflict")
	}
	if _, _, err := a.repo().Find("demo"); err == nil {
		t.Fatal("hub skill should have been rolled back to trash")
	}
	items, err = a.ListTrash()
	if err != nil || len(items) != 1 {
		t.Fatalf("skill should be back in trash, items=%d err=%v", len(items), err)
	}
}

func TestMoveI18nSidecarUsesTrashLeafName(t *testing.T) {
	a, hub := newTestApp(t)
	if err := a.CreateSkill("demo", "Demo", "", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	addTranslation(t, hub, "demo", "en", "en-body")
	trashPath := filepath.Join(hub, "_trash", "20200101-120000", "default", "demo-99")
	if err := moveI18nToTrashSidecar(hub, "demo", trashPath); err != nil {
		t.Fatal(err)
	}
	sidecar := trash.I18nSidecar(filepath.Join(hub, "_trash", "20200101-120000"), "demo-99")
	if _, err := os.Stat(filepath.Join(sidecar, "en", "SKILL.md")); err != nil {
		t.Fatalf("sidecar should use trash leaf name: %v", err)
	}
	if _, err := os.Stat(skilli18n.New(hub).SkillDir("demo")); !os.IsNotExist(err) {
		t.Fatal("live translation dir should be gone")
	}
}

func TestRestoreI18nRejectsExistingDisplacedSidecar(t *testing.T) {
	_, hub := newTestApp(t)
	if err := skilli18n.New(hub).InitDefault("demo", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	orig := filepath.Join(hub, "_trash", "orig", "default", "demo")
	displaced := filepath.Join(hub, "_trash", "disp", "default", "demo")
	if err := os.MkdirAll(filepath.Dir(orig), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(displaced), 0o755); err != nil {
		t.Fatal(err)
	}
	dest := trash.I18nSidecar(filepath.Join(hub, "_trash", "disp"), "demo")
	if err := os.MkdirAll(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := restoreI18nFromTrashSidecar(hub, orig, displaced); err == nil {
		t.Fatal("expected displaced sidecar conflict")
	}
	if _, err := os.Stat(skilli18n.New(hub).SkillDir("demo")); err != nil {
		t.Fatalf("live translations should stay: %v", err)
	}
}
