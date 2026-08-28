package skillrepo

import (
	"os"
	"path/filepath"
	"testing"

	"SkillsManager/internal/trash"
)

func TestMigrateRootSkillsToDefault(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	flat := filepath.Join(hub, "old")
	_ = os.MkdirAll(flat, 0o755)
	_ = os.WriteFile(filepath.Join(flat, "SKILL.md"), []byte("---\nname: Old\n---\n"), 0o644)
	_ = os.MkdirAll(filepath.Join(hub, "keep-group"), 0o755) // 空分组
	moved, skipped, err := r.MigrateRootSkillsToDefault()
	if err != nil {
		t.Fatal(err)
	}
	if len(moved) != 1 || moved[0] != "old" || len(skipped) != 0 {
		t.Fatalf("moved=%v skipped=%v", moved, skipped)
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "old", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(hub, "keep-group")); err != nil {
		t.Fatal(err)
	}
}

func TestListRootSkillIDs(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	writeSkillDir(t, filepath.Join(hub, "flat"))
	if err := os.MkdirAll(filepath.Join(hub, "keep-group"), 0o755); err != nil {
		t.Fatal(err)
	}
	ids, err := r.ListRootSkillIDs()
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != "flat" {
		t.Fatalf("ids=%v", ids)
	}
}

func TestMigrateRootSkillToDefaultRenamesWhenDestExists(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	writeSkillDir(t, filepath.Join(hub, "demo"))
	writeSkillDir(t, filepath.Join(hub, "default", "demo"))
	destID, moved, err := r.MigrateRootSkillToDefault("demo")
	if err != nil {
		t.Fatal(err)
	}
	if !moved {
		t.Fatal("root leftover must migrate under a unique id, not stay skipped")
	}
	if destID != "demo-orphan" {
		t.Fatalf("destID=%q want demo-orphan", destID)
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "demo", "SKILL.md")); err != nil {
		t.Fatal("must not overwrite default/demo")
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "demo-orphan", "SKILL.md")); err != nil {
		t.Fatalf("expected hub/default/demo-orphan: %v", err)
	}
	if _, err := os.Stat(filepath.Join(hub, "demo", "SKILL.md")); !os.IsNotExist(err) {
		t.Fatal("root leftover must be gone after rename-migrate")
	}
}

func TestMigrateRootSkillToDefaultUniqueOrphanSuffix(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	writeSkillDir(t, filepath.Join(hub, "demo"))
	writeSkillDir(t, filepath.Join(hub, "default", "demo"))
	writeSkillDir(t, filepath.Join(hub, "default", "demo-orphan"))
	destID, moved, err := r.MigrateRootSkillToDefault("demo")
	if err != nil {
		t.Fatal(err)
	}
	if !moved || destID != "demo-orphan-2" {
		t.Fatalf("moved=%v destID=%q want demo-orphan-2", moved, destID)
	}
}

func writeSkillDir(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("---\nname: X\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}
