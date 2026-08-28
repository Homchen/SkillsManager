package skillrepo

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"SkillsManager/internal/trash"
)

func TestCreateAndReadWrite(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	if err := r.Create("nested", "Demo", "demo"); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(hub, "demo", "nested", "SKILL.md")
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(b) == 0 {
		t.Fatal("empty skill md")
	}
	if err := r.WriteFile("nested", "notes.md", "hello"); err != nil {
		t.Fatal(err)
	}
	got, err := r.ReadFile("nested", "notes.md")
	if err != nil || got != "hello" {
		t.Fatalf("got %q err=%v", got, err)
	}
}

func TestDeleteMovesToTrash(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	_ = r.Create("gone", "Gone", "")
	if err := r.Delete("gone"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "gone")); !os.IsNotExist(err) {
		t.Fatal("should be removed from hub")
	}
}

func TestCreateRejectsDotDot(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	if err := r.Create("../escape", "Bad", ""); err == nil {
		t.Fatal("expected error for .. in id")
	}
	if err := r.Create("ok/../bad", "Bad", ""); err == nil {
		t.Fatal("expected error for .. segment in id")
	}
}

func TestReadWriteRejectPathTraversal(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	if err := r.Create("safe", "Safe", ""); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hub, "outside.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := r.ReadFile("safe", "../outside.txt"); err == nil || !strings.Contains(err.Error(), "路径越界") {
		t.Fatalf("expected 路径越界 on ReadFile, got %v", err)
	}
	if err := r.WriteFile("safe", "../../outside.txt", "x"); err == nil || !strings.Contains(err.Error(), "路径越界") {
		t.Fatalf("expected 路径越界 on WriteFile, got %v", err)
	}
}

func TestReadWriteRejectSiblingEscapeEvenIfExists(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	if err := r.Create("safe", "Safe", ""); err != nil {
		t.Fatal(err)
	}
	sibling := filepath.Join(hub, "default", "sibling.txt")
	if err := os.WriteFile(sibling, []byte("sibling-secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := r.ReadFile("safe", "../sibling.txt")
	if err == nil {
		t.Fatalf("expected error, unexpectedly read %q", got)
	}
	if !strings.Contains(err.Error(), "路径越界") {
		t.Fatalf("expected 路径越界, got %v", err)
	}
	if err := r.WriteFile("safe", "../sibling.txt", "overwrite"); err == nil || !strings.Contains(err.Error(), "路径越界") {
		t.Fatalf("expected 路径越界 on WriteFile, got %v", err)
	}
	b, err := os.ReadFile(sibling)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "sibling-secret" {
		t.Fatalf("sibling must remain untouched, got %q", b)
	}
}

func TestReadWriteRejectSymlinkEscape(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	if err := r.Create("safe", "Safe", ""); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secret, []byte("top-secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	escape := filepath.Join(hub, "default", "safe", "escape")
	if err := os.Symlink(outside, escape); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := r.ReadFile("safe", "escape/secret.txt"); err == nil || !strings.Contains(err.Error(), "路径越界") {
		t.Fatalf("expected symlink escape rejection, got %v", err)
	}
	if err := r.WriteFile("safe", "escape/pwned.txt", "x"); err == nil || !strings.Contains(err.Error(), "路径越界") {
		t.Fatalf("expected symlink escape rejection on write, got %v", err)
	}
}

func TestListFilesAndRename(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	if err := r.Create("old", "Old", ""); err != nil {
		t.Fatal(err)
	}
	if err := r.WriteFile("old", "extra.md", "e"); err != nil {
		t.Fatal(err)
	}
	files, err := r.ListFiles("old")
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(files, ",")
	if !strings.Contains(joined, "SKILL.md") || !strings.Contains(joined, "extra.md") {
		t.Fatalf("files=%v", files)
	}
	for _, f := range files {
		if f == "." || f == "" {
			t.Fatalf("unexpected entry %q", f)
		}
	}
	if err := r.Rename("old", "newname"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "old")); !os.IsNotExist(err) {
		t.Fatal("old id should be gone")
	}
	got, err := r.ReadFile("newname", "extra.md")
	if err != nil || got != "e" {
		t.Fatalf("rename read got %q err=%v", got, err)
	}
}

func TestCreateInGroup(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	if err := r.Create("nested", "Demo", "demo"); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(hub, "demo", "nested", "SKILL.md")
	if _, err := os.Stat(p); err != nil {
		t.Fatal(err)
	}
}

func TestCreateDefaultGroup(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	if err := r.Create("x", "X", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "x", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
}

func TestFindAcrossGroups(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	_ = r.Create("a", "A", "g1")
	group, path, err := r.Find("a")
	if err != nil || group != "g1" {
		t.Fatalf("group=%s path=%s err=%v", group, path, err)
	}
}

func TestValidateGroupNameRejectsDefault(t *testing.T) {
	if err := ValidateGroupName("default"); err == nil {
		t.Fatal("expected error")
	}
	if err := ValidateGroupName("a/b"); err == nil {
		t.Fatal("expected error")
	}
}

func TestCreateFileAndMkdir(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	if err := r.Create("demo", "Demo", ""); err != nil {
		t.Fatal(err)
	}
	if err := r.Mkdir("demo", "docs/guides"); err != nil {
		t.Fatal(err)
	}
	if err := r.CreateFile("demo", "docs/guides/intro.md"); err != nil {
		t.Fatal(err)
	}
	got, err := r.ReadFile("demo", "docs/guides/intro.md")
	if err != nil || got != "" {
		t.Fatalf("got %q err=%v", got, err)
	}
	if err := r.CreateFile("demo", "docs/guides/intro.md"); err == nil {
		t.Fatal("expected duplicate create to fail")
	}
	if err := r.Mkdir("demo", "docs/guides"); err == nil {
		t.Fatal("expected duplicate mkdir to fail")
	}
	if err := r.Mkdir("demo", "empty-only"); err != nil {
		t.Fatal(err)
	}
	files, err := r.ListFiles("demo")
	if err != nil {
		t.Fatal(err)
	}
	hasEmpty := false
	for _, f := range files {
		if f == "empty-only/" {
			hasEmpty = true
		}
		if f == "docs/" || f == "docs/guides/" {
			t.Fatalf("non-empty dirs should not be listed, files=%v", files)
		}
	}
	if !hasEmpty {
		t.Fatalf("expected empty dir marker, files=%v", files)
	}
}

func TestRenameAndDeleteEntry(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	if err := r.Create("demo", "Demo", ""); err != nil {
		t.Fatal(err)
	}
	if err := r.WriteFile("demo", "docs/old.md", "hello"); err != nil {
		t.Fatal(err)
	}
	if err := r.RenameEntry("demo", "docs/old.md", "docs/new.md"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.ReadFile("demo", "docs/old.md"); err == nil {
		t.Fatal("old path should be gone")
	}
	got, err := r.ReadFile("demo", "docs/new.md")
	if err != nil || got != "hello" {
		t.Fatalf("renamed file got %q err=%v", got, err)
	}
	if err := r.RenameEntry("demo", "docs", "guide"); err != nil {
		t.Fatal(err)
	}
	if err := r.DeleteEntry("demo", "guide"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(hub, "default", "demo", "guide")); !os.IsNotExist(err) {
		t.Fatalf("renamed directory should be deleted, err=%v", err)
	}
}

func TestRenameAndDeleteEntryRejectInvalidPaths(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	if err := r.Create("demo", "Demo", ""); err != nil {
		t.Fatal(err)
	}
	if err := r.WriteFile("demo", "keep.md", "keep"); err != nil {
		t.Fatal(err)
	}
	if err := r.RenameEntry("demo", "keep.md", "../outside.md"); err == nil {
		t.Fatal("expected traversal rename to fail")
	}
	if err := r.DeleteEntry("demo", ".."); err == nil {
		t.Fatal("expected traversal delete to fail")
	}
	if err := r.RenameEntry("demo", "keep.md", "SKILL.md"); err == nil {
		t.Fatal("expected existing destination to fail")
	}
	got, err := r.ReadFile("demo", "keep.md")
	if err != nil || got != "keep" {
		t.Fatalf("source must remain unchanged, got %q err=%v", got, err)
	}
}

func TestProtectRootSkillDefinition(t *testing.T) {
	hub := t.TempDir()
	r := New(hub, trash.New(hub))
	if err := r.Create("demo", "Demo", ""); err != nil {
		t.Fatal(err)
	}
	if err := r.WriteFile("demo", "nested/SKILL.md", "nested"); err != nil {
		t.Fatal(err)
	}
	if err := r.DeleteEntry("demo", "SKILL.md"); err == nil || !strings.Contains(err.Error(), "不能删除技能根目录的 SKILL.md") {
		t.Fatalf("expected root SKILL.md delete rejection, got %v", err)
	}
	if err := r.RenameEntry("demo", "SKILL.md", "README.md"); err == nil || !strings.Contains(err.Error(), "不能重命名技能根目录的 SKILL.md") {
		t.Fatalf("expected root SKILL.md rename rejection, got %v", err)
	}
	if _, _, err := r.Find("demo"); err != nil {
		t.Fatalf("skill must still be findable after rejected mutations: %v", err)
	}
	if err := r.DeleteEntry("demo", "nested/SKILL.md"); err != nil {
		t.Fatalf("nested SKILL.md should remain deletable: %v", err)
	}
}
