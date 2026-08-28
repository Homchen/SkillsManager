package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"SkillsManager/internal/config"
	"SkillsManager/internal/linker"
	"SkillsManager/internal/skilli18n"
	"SkillsManager/internal/skillrepo"
	"SkillsManager/internal/trash"
)

func skipIfSymlinkPermission(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		return
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "privilege") ||
		strings.Contains(msg, "not held") ||
		strings.Contains(msg, "a required privilege") ||
		errors.Is(err, os.ErrPermission) {
		t.Skipf("symlink unavailable: %v", err)
	}
}

func TestUnlinkSkillToolLinksBeforeDelete(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	tool := filepath.Join(root, "tool")
	cfg := config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "skills", Path: hub, Enabled: true, IsHub: true},
			{ID: "cursor", Path: tool, Enabled: true},
		},
	}
	repo := skillrepo.New(hub, trash.New(hub))
	if err := repo.Create("demo", "Demo", ""); err != nil {
		t.Fatal(err)
	}
	hubSkill := filepath.Join(hub, "default", "demo")
	linkPath := filepath.Join(tool, "demo")
	if err := linker.EnsureSymlink(linkPath, hubSkill); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if err := unlinkSkillToolLinks(cfg, "demo"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(linkPath); !os.IsNotExist(err) {
		t.Fatalf("tool symlink should be removed, err=%v", err)
	}
	if err := repo.Delete("demo"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(hubSkill); !os.IsNotExist(err) {
		t.Fatal("hub skill should be trashed")
	}
}

func TestRelinkSkillHubTargetUnelevatedPreservesSymlink(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	oldSkill := filepath.Join(hub, "default", "demo")
	newSkill := filepath.Join(hub, "自定义", "demo")
	tool := filepath.Join(root, "tool")
	linkPath := filepath.Join(tool, "demo")

	if err := os.MkdirAll(oldSkill, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(newSkill), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldSkill, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tool, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := linker.EnsureSymlink(linkPath, oldSkill); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	// Simulate group move of hub content.
	if err := os.Rename(oldSkill, newSkill); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "cursor", Path: tool, Enabled: true},
		},
	}
	err := relinkSkillHubTarget(cfg, "demo", newSkill, false)
	if err == nil || !strings.Contains(err.Error(), errNeedAdmin) {
		t.Fatalf("expected errNeedAdmin, got %v", err)
	}
	fi, err := os.Lstat(linkPath)
	if err != nil {
		t.Fatalf("symlink must still exist: %v", err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("path should remain a symlink")
	}
	target, err := os.Readlink(linkPath)
	if err != nil {
		t.Fatal(err)
	}
	absTarget, _ := filepath.Abs(target)
	absOld, _ := filepath.Abs(oldSkill)
	if !strings.EqualFold(filepath.Clean(absTarget), filepath.Clean(absOld)) {
		t.Fatalf("unelevated must keep old target %q, got %q", absOld, absTarget)
	}
}

func TestRelinkSkillAfterRenameUnelevatedPreservesSymlink(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	skill := filepath.Join(hub, "default", "newname")
	tool := filepath.Join(root, "tool")
	oldLink := filepath.Join(tool, "oldname")

	if err := os.MkdirAll(skill, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skill, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tool, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := linker.EnsureSymlink(oldLink, skill); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}

	cfg := config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "cursor", Path: tool, Enabled: true},
		},
	}
	err := relinkSkillAfterRename(cfg, "oldname", "newname", skill, false)
	if err == nil || !strings.Contains(err.Error(), errNeedAdmin) {
		t.Fatalf("expected errNeedAdmin, got %v", err)
	}
	if _, err := os.Lstat(oldLink); err != nil {
		t.Fatalf("old symlink must remain: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(tool, "newname")); !os.IsNotExist(err) {
		t.Fatal("must not create new link when unelevated")
	}
}

func writeRootSkill(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("---\nname: Foo\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func setupRootSkillAndTool(t *testing.T) (cfg config.Config, hub, skillDir, linkPath string) {
	t.Helper()
	root := t.TempDir()
	hub = filepath.Join(root, "hub")
	tool := filepath.Join(root, "tool")
	skillDir = filepath.Join(hub, "foo")
	linkPath = filepath.Join(tool, "foo")
	writeRootSkill(t, skillDir)
	if err := os.MkdirAll(tool, 0o755); err != nil {
		t.Fatal(err)
	}
	cfg = config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "skills", Path: hub, Enabled: true, IsHub: true},
			{ID: "cursor", Path: tool, Enabled: true},
		},
	}
	return cfg, hub, skillDir, linkPath
}

func assertSymlinkTarget(t *testing.T, link, want string) {
	t.Helper()
	fi, err := os.Lstat(link)
	if err != nil {
		t.Fatalf("symlink must exist: %v", err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("path should remain a symlink")
	}
	target, err := os.Readlink(link)
	if err != nil {
		t.Fatal(err)
	}
	absTarget, _ := filepath.Abs(target)
	absWant, _ := filepath.Abs(want)
	if !strings.EqualFold(filepath.Clean(absTarget), filepath.Clean(absWant)) {
		t.Fatalf("symlink target %q, want %q", absTarget, absWant)
	}
}

func TestMigrateRootSkillsAndRelinkUnelevatedKeepsLinkedRootSkill(t *testing.T) {
	cfg, hub, skillDir, linkPath := setupRootSkillAndTool(t)
	if err := linker.EnsureSymlink(linkPath, skillDir); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}

	err := migrateRootSkillsAndRelink(cfg, skillrepo.New(hub, trash.New(hub)), false)
	if err == nil || !strings.Contains(err.Error(), errNeedAdmin) {
		t.Fatalf("expected errNeedAdmin, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(skillDir, "SKILL.md")); err != nil {
		t.Fatalf("root skill must stay when unelevated: %v", err)
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "foo", "SKILL.md")); !os.IsNotExist(err) {
		t.Fatal("must not rename hub/foo into default/ when tool link exists and unelevated")
	}
	assertSymlinkTarget(t, linkPath, skillDir)
}

func TestMigrateRootSkillsAndRelinkUnelevatedMigratesUnlinkedRootSkill(t *testing.T) {
	cfg, hub, skillDir, _ := setupRootSkillAndTool(t)

	if err := migrateRootSkillsAndRelink(cfg, skillrepo.New(hub, trash.New(hub)), false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(skillDir, "SKILL.md")); !os.IsNotExist(err) {
		t.Fatal("unlinked root skill should migrate")
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "foo", "SKILL.md")); err != nil {
		t.Fatalf("expected hub/default/foo: %v", err)
	}
}

func TestMigrateRootSkillsAndRelinkElevatedMovesAndRelinks(t *testing.T) {
	cfg, hub, skillDir, linkPath := setupRootSkillAndTool(t)
	if err := linker.EnsureSymlink(linkPath, skillDir); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}

	if err := migrateRootSkillsAndRelink(cfg, skillrepo.New(hub, trash.New(hub)), true); err != nil {
		t.Fatal(err)
	}
	newSkill := filepath.Join(hub, "default", "foo")
	if _, err := os.Stat(filepath.Join(newSkill, "SKILL.md")); err != nil {
		t.Fatalf("expected migrated skill: %v", err)
	}
	if _, err := os.Stat(filepath.Join(skillDir, "SKILL.md")); !os.IsNotExist(err) {
		t.Fatal("old hub/foo should be gone")
	}
	assertSymlinkTarget(t, linkPath, newSkill)
}

func TestListSkillsMigratesUnlinkedRootSkill(t *testing.T) {
	cfg, hub, skillDir, _ := setupRootSkillAndTool(t)

	a := newAppCore()
	a.cfg = cfg
	a.elevatedFn = func() bool { return false }

	if _, err := a.ListSkills(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(skillDir, "SKILL.md")); !os.IsNotExist(err) {
		t.Fatal("unlinked root skill should migrate on ListSkills")
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "foo", "SKILL.md")); err != nil {
		t.Fatalf("expected hub/default/foo: %v", err)
	}
}

func TestListSkillsUnelevatedDoesNotMigrateLinkedRootSkill(t *testing.T) {
	cfg, hub, skillDir, linkPath := setupRootSkillAndTool(t)
	if err := linker.EnsureSymlink(linkPath, skillDir); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}

	a := newAppCore()
	a.cfg = cfg
	a.elevatedFn = func() bool { return false }

	entries, err := a.ListSkills()
	if err != nil {
		t.Fatalf("ListSkills should still return the list: %v", err)
	}
	if _, err := os.Stat(filepath.Join(skillDir, "SKILL.md")); err != nil {
		t.Fatalf("ListSkills must not rename linked root skill when unelevated: %v", err)
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "foo", "SKILL.md")); !os.IsNotExist(err) {
		t.Fatal("hub/foo must not move to default/")
	}
	assertSymlinkTarget(t, linkPath, skillDir)
	if len(entries) == 0 {
		t.Fatal("expected skill still visible via tool link")
	}
}

func TestListSkillsRenamesRootSkillWhenDefaultExists(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	writeRootSkill(t, filepath.Join(hub, "demo"))
	writeRootSkill(t, filepath.Join(hub, "default", "demo"))
	a := newAppCore()
	a.cfg = config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "skills", Path: hub, Enabled: true, IsHub: true},
		},
	}
	a.elevatedFn = func() bool { return false }

	entries, err := a.ListSkills()
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, e := range entries {
		ids[e.ID] = true
	}
	if !ids["demo"] || !ids["demo-orphan"] {
		t.Fatalf("ids=%v want demo and demo-orphan", ids)
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "demo", "SKILL.md")); err != nil {
		t.Fatal("must keep original default/demo")
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "demo-orphan", "SKILL.md")); err != nil {
		t.Fatal("root leftover must appear as default/demo-orphan")
	}
	if _, err := os.Stat(filepath.Join(hub, "demo", "SKILL.md")); !os.IsNotExist(err) {
		t.Fatal("hub/demo must not remain after ListSkills")
	}
}

func TestNearestExistingDir(t *testing.T) {
	root := t.TempDir()
	exist := filepath.Join(root, "a", "b")
	if err := os.MkdirAll(exist, 0o755); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(exist, "c", "d")
	got := nearestExistingDir(missing)
	if got != exist {
		t.Fatalf("got %q want %q", got, exist)
	}
	if nearestExistingDir(exist) != exist {
		t.Fatalf("existing dir should return itself")
	}
	file := filepath.Join(exist, "f.txt")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if nearestExistingDir(file) != exist {
		t.Fatalf("file should open parent dir")
	}
}

func TestSetSkillDefaultLanguageUnelevatedDoesNotRequireRelink(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	tool := filepath.Join(root, "tool")
	id := "demo"
	hubSkill := filepath.Join(hub, "default", id)
	if err := os.MkdirAll(hubSkill, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hubSkill, "SKILL.md"), []byte("zh"), 0o644); err != nil {
		t.Fatal(err)
	}
	store := skilli18n.New(hub)
	if err := store.InitDefault(id, "zh-CN"); err != nil {
		t.Fatal(err)
	}
	en := store.VersionPath(id, "en")
	if err := os.MkdirAll(en, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(en, "SKILL.md"), []byte("en"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := store.AddTranslationLanguage(id, "en"); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tool, 0o755); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(tool, id)
	if err := linker.EnsureSymlink(linkPath, hubSkill); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}

	a := newAppCore()
	a.cfg = config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "cursor", Path: tool, Enabled: true},
		},
	}
	a.elevatedFn = func() bool { return false }

	if err := a.SetSkillDefaultLanguage(id, "en"); err != nil {
		t.Fatalf("language swap should succeed without elevation: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(hubSkill, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "en" {
		t.Fatalf("hub content = %q, want en", b)
	}
	assertSymlinkTarget(t, linkPath, hubSkill)
}
