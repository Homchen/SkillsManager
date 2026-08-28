package skillrepo

import (
	"os"
	"path/filepath"
	"testing"

	"SkillsManager/internal/domain"
	"SkillsManager/internal/trash"
)

func TestGroupCRUDAndSetSkillGroup(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	if err := r.CreateGroup("工作流"); err != nil {
		t.Fatal(err)
	}
	if err := r.Create("s1", "S1", "default"); err != nil {
		t.Fatal(err)
	}
	if err := r.SetSkillGroup("s1", "工作流"); err != nil {
		t.Fatal(err)
	}
	g, path, err := r.Find("s1")
	if err != nil || g != "工作流" {
		t.Fatalf("g=%s path=%s err=%v", g, path, err)
	}
	if err := r.RenameGroup("工作流", "流程"); err != nil {
		t.Fatal(err)
	}
	g, _, err = r.Find("s1")
	if err != nil || g != "流程" {
		t.Fatalf("after rename g=%s err=%v", g, err)
	}
	if err := r.DeleteGroup("流程"); err != nil {
		t.Fatal(err)
	}
	g, _, err = r.Find("s1")
	if err != nil || g != domain.DefaultGroup {
		t.Fatalf("want default, g=%s err=%v", g, err)
	}
	if err := r.DeleteGroup(domain.DefaultGroup); err == nil {
		t.Fatal("default must not delete")
	}
	if err := r.RenameGroup(domain.DefaultGroup, "x"); err == nil {
		t.Fatal("default must not rename")
	}
}

func TestSetSkillGroupConflict(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	_ = r.CreateGroup("g")
	_ = r.Create("x", "X", "default")
	_ = os.MkdirAll(filepath.Join(hub, "g", "x"), 0o755)
	_ = os.WriteFile(filepath.Join(hub, "g", "x", "SKILL.md"), []byte("---\nname: Y\n---\n"), 0o644)
	if err := r.SetSkillGroup("x", "g"); err == nil {
		t.Fatal("expected conflict")
	}
}
