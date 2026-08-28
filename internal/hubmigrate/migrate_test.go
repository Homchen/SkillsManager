package hubmigrate

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"SkillsManager/internal/fsutil"
)

func TestNeedsContentMigrate(t *testing.T) {
	root := t.TempDir()
	missing := filepath.Join(root, "nope")
	if NeedsContentMigrate(missing) {
		t.Fatal("missing should be false")
	}
	empty := filepath.Join(root, "empty")
	if err := os.MkdirAll(empty, 0o755); err != nil {
		t.Fatal(err)
	}
	if NeedsContentMigrate(empty) {
		t.Fatal("empty dir should be false")
	}
	full := filepath.Join(root, "full")
	if err := os.MkdirAll(full, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(full, "x"), []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !NeedsContentMigrate(full) {
		t.Fatal("non-empty should be true")
	}
}

func TestMigrateEmptyOldIsNoop(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "old")
	neu := filepath.Join(root, "new")
	if err := os.MkdirAll(old, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(old, neu, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(neu); err != nil {
		t.Fatalf("new hub should exist after Ensure: %v", err)
	}
}

func TestMigrateRejectsAncestor(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "hub")
	neu := filepath.Join(old, "nested")
	if err := os.MkdirAll(old, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(old, "f"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(old, neu, nil); err == nil {
		t.Fatal("expected ancestor error")
	}
}

func TestMigrateRejectsNonEmptyTarget(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "old")
	neu := filepath.Join(root, "new")
	if err := os.MkdirAll(old, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(old, "a"), []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(neu, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(neu, "b"), []byte("2"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(old, neu, nil); err == nil {
		t.Fatal("expected non-empty target error")
	}
	if _, err := os.Stat(filepath.Join(old, "a")); err != nil {
		t.Fatal("old content must remain")
	}
}

func TestMigrateMovesContentAndTrash(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "old")
	neu := filepath.Join(root, "new")
	skill := filepath.Join(old, "foo")
	trashItem := filepath.Join(old, "_trash", "20260101-120000", "bar")
	if err := os.MkdirAll(skill, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skill, "SKILL.md"), []byte("---\nname: Foo\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(trashItem, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(trashItem, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(old, neu, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(neu, "foo", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(neu, "_trash", "20260101-120000", "bar", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(old, "foo")); !os.IsNotExist(err) {
		t.Fatalf("old skill should be gone, err=%v", err)
	}
}

func TestMigrateRewritesSymlinks(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "old")
	neu := filepath.Join(root, "new")
	tool := filepath.Join(root, "tool")
	skill := filepath.Join(old, "foo")
	if err := os.MkdirAll(skill, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skill, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tool, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(tool, "foo")
	if err := os.Symlink(skill, link); err != nil {
		t.Skip("symlink requires elevation on this Windows host")
	}
	if err := Migrate(old, neu, []string{tool}); err != nil {
		t.Fatal(err)
	}
	target, err := os.Readlink(link)
	if err != nil {
		t.Fatal(err)
	}
	absTarget, _ := filepath.Abs(target)
	want, _ := filepath.Abs(filepath.Join(neu, "foo"))
	if !fsutil.SamePath(absTarget, want) {
		t.Fatalf("link target=%q want=%q", absTarget, want)
	}
}

func TestMigrateErrorsWhenOldHubIsFile(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "old-file")
	neu := filepath.Join(root, "new")
	if err := os.WriteFile(old, []byte("not-a-dir"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := Migrate(old, neu, nil)
	if err == nil {
		t.Fatal("expected error when old hub is a file")
	}
	if _, err := os.Stat(neu); !os.IsNotExist(err) {
		t.Fatalf("new hub must not be created on failed migrate, err=%v", err)
	}
}

func TestMigrateRollbackOnRewriteFailure(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "old")
	neu := filepath.Join(root, "new")
	tool := filepath.Join(root, "tool")
	skillA := filepath.Join(old, "foo")
	skillB := filepath.Join(old, "bar")
	for _, skill := range []string{skillA, skillB} {
		if err := os.MkdirAll(skill, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(skill, "SKILL.md"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(tool, 0o755); err != nil {
		t.Fatal(err)
	}
	linkA := filepath.Join(tool, "foo")
	linkB := filepath.Join(tool, "bar")
	if err := os.Symlink(skillA, linkA); err != nil {
		t.Skip("symlink requires elevation on this Windows host")
	}
	if err := os.Symlink(skillB, linkB); err != nil {
		t.Skip("symlink requires elevation on this Windows host")
	}

	prev := ensureSymlink
	calls := 0
	ensureSymlink = func(linkPath, target string) error {
		calls++
		if calls == 2 {
			return fmt.Errorf("injected rewrite failure on 2nd call")
		}
		return prev(linkPath, target)
	}
	t.Cleanup(func() { ensureSymlink = prev })

	err := Migrate(old, neu, []string{tool})
	if err == nil {
		t.Fatal("expected error")
	}
	if _, err := os.Stat(filepath.Join(old, "foo", "SKILL.md")); err != nil {
		t.Fatalf("content should roll back to old: %v", err)
	}
	if _, err := os.Stat(filepath.Join(old, "bar", "SKILL.md")); err != nil {
		t.Fatalf("content should roll back to old: %v", err)
	}

	wantA, _ := filepath.Abs(skillA)
	wantB, _ := filepath.Abs(skillB)
	for _, tc := range []struct {
		link string
		want string
	}{
		{linkA, wantA},
		{linkB, wantB},
	} {
		target, err := os.Readlink(tc.link)
		if err != nil {
			t.Fatalf("readlink %s: %v", tc.link, err)
		}
		absTarget, _ := filepath.Abs(target)
		if !fsutil.SamePath(absTarget, tc.want) {
			t.Fatalf("after rollback link %s target=%q want=%q (must not stay on new hub)", tc.link, absTarget, tc.want)
		}
	}
}
