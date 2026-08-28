package trash

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"SkillsManager/internal/domain"
)

func writeSkill(t *testing.T, dir, body string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestRestoreNoConflict(t *testing.T) {
	hub := t.TempDir()
	st := New(hub)
	src := filepath.Join(hub, "pkg", "a")
	writeSkill(t, src, "v1")
	dest, err := st.Move(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Restore(dest, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(hub, "pkg", "a", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
}

func TestRestoreFallsBackToDefaultWhenGroupMissing(t *testing.T) {
	hub := t.TempDir()
	st := New(hub)
	src := filepath.Join(hub, "gone-group", "leaf")
	writeSkill(t, src, "restored")
	dest, err := st.Move(src)
	if err != nil {
		t.Fatal(err)
	}
	// 删除原分组目录（Move 后可能已空并被清掉；确保不存在）
	_ = os.RemoveAll(filepath.Join(hub, "gone-group"))
	if err := st.Restore(dest, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(hub, domain.DefaultGroup, "leaf", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(hub, "gone-group", "leaf")); !os.IsNotExist(err) {
		t.Fatal("should not restore into missing group")
	}
}

func TestRestoreConflictRequiresOverwrite(t *testing.T) {
	hub := t.TempDir()
	st := New(hub)
	src := filepath.Join(hub, domain.DefaultGroup, "a")
	writeSkill(t, src, "old")
	dest, err := st.Move(src)
	if err != nil {
		t.Fatal(err)
	}
	writeSkill(t, filepath.Join(hub, domain.DefaultGroup, "a"), "newer")
	if err := st.Restore(dest, false); !errors.Is(err, ErrTargetExists) {
		t.Fatalf("err=%v", err)
	}
	if err := st.Restore(dest, true); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(hub, domain.DefaultGroup, "a", "SKILL.md"))
	if string(b) != "old" {
		t.Fatalf("restored=%q", b)
	}
	items, err := st.List(7)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) == 0 {
		t.Fatal("overwritten hub copy should be in trash")
	}
}

func TestMoveKeepsContentUnderTrash(t *testing.T) {
	hub := t.TempDir()
	src := filepath.Join(t.TempDir(), "skill-a")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	st := New(hub)
	dest, err := st.Move(src)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatalf("src should be gone, err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "SKILL.md")); err != nil {
		t.Fatal(err)
	}
	rel, err := filepath.Rel(hub, dest)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(filepath.ToSlash(rel), "_trash/") {
		t.Fatalf("dest not under trash: %s", dest)
	}
}

func TestMovePreservesHubRelativePath(t *testing.T) {
	hub := t.TempDir()
	src := filepath.Join(hub, "pkg", "examples", "foo")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "SKILL.md"), []byte("---\nname: Foo\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	dest, err := New(hub).Move(src)
	if err != nil {
		t.Fatal(err)
	}
	rel, err := filepath.Rel(filepath.Join(hub, "_trash"), dest)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	if len(parts) < 4 || parts[1] != "pkg" || parts[2] != "examples" || parts[3] != "foo" {
		t.Fatalf("dest rel=%q want <ts>/pkg/examples/foo", rel)
	}
}

func TestMoveOutsideHubUsesBasename(t *testing.T) {
	hub := t.TempDir()
	src := filepath.Join(t.TempDir(), "skill-a")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	dest, err := New(hub).Move(src)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(dest) != "skill-a" {
		t.Fatalf("dest base=%s", filepath.Base(dest))
	}
}

func TestListFindsNestedAndFlat(t *testing.T) {
	hub := t.TempDir()
	st := New(hub)
	nested := filepath.Join(hub, "pkg", "foo")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "SKILL.md"), []byte("---\nname: Nested\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Move(nested); err != nil {
		t.Fatal(err)
	}
	// 旧扁平：手工造 _trash/<ts>/flat/SKILL.md
	flatBucket := filepath.Join(hub, "_trash", "20200101-120000")
	flat := filepath.Join(flatBucket, "flat")
	if err := os.MkdirAll(flat, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(flat, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	items, err := st.List(7)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, it := range items {
		ids[it.ID] = true
		if it.TrashPath == "" || it.DeletedAt == "" || it.ExpiresAt == "" {
			t.Fatalf("incomplete item: %+v", it)
		}
	}
	if !ids["pkg/foo"] || !ids["flat"] {
		t.Fatalf("ids=%v", ids)
	}
}

func TestPurgeEntryRemovesSkill(t *testing.T) {
	hub := t.TempDir()
	st := New(hub)
	src := filepath.Join(hub, "gone")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	dest, err := st.Move(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.PurgeEntry(dest); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatal("expected purged")
	}
}

func TestPurgeEntryRejectsOutsideTrash(t *testing.T) {
	hub := t.TempDir()
	st := New(hub)
	outside := filepath.Join(hub, "not-trash")
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := st.PurgeEntry(outside); err == nil {
		t.Fatal("expected error")
	}
}

func TestPurgeEntryRemovesEmptyTimestampBucket(t *testing.T) {
	hub := t.TempDir()
	st := New(hub)
	src := filepath.Join(hub, "pkg", "foo")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	dest, err := st.Move(src)
	if err != nil {
		t.Fatal(err)
	}
	// dest = _trash/<ts>/pkg/foo
	tsBucket := filepath.Dir(filepath.Dir(dest))
	trashRoot := filepath.Join(hub, "_trash")
	if filepath.Dir(tsBucket) != trashRoot {
		t.Fatalf("tsBucket=%s not under trash root", tsBucket)
	}
	if err := st.PurgeEntry(dest); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatal("expected skill purged")
	}
	if _, err := os.Stat(tsBucket); !os.IsNotExist(err) {
		t.Fatalf("expected empty ts bucket removed, still exists: %s", tsBucket)
	}
	// trash root 本身应保留
	if _, err := os.Stat(trashRoot); err != nil {
		t.Fatalf("trash root should remain: %v", err)
	}
}

func TestPurgeEntryRejectsTrashRoot(t *testing.T) {
	hub := t.TempDir()
	st := New(hub)
	if err := os.MkdirAll(st.root(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := st.PurgeEntry(st.root()); err == nil {
		t.Fatal("expected error for trash root")
	}
}

func TestRestoreOutsideHubGoesToDefault(t *testing.T) {
	hub := t.TempDir()
	st := New(hub)
	src := filepath.Join(t.TempDir(), "skill-a")
	writeSkill(t, src, "outside")
	dest, err := st.Move(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Restore(dest, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(hub, domain.DefaultGroup, "skill-a", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
}

func TestRestoreCrossGroupSameLeafDoesNotBlock(t *testing.T) {
	hub := t.TempDir()
	st := New(hub)
	src := filepath.Join(hub, "alpha", "leaf")
	writeSkill(t, src, "from-alpha")
	dest, err := st.Move(src)
	if err != nil {
		t.Fatal(err)
	}
	writeSkill(t, filepath.Join(hub, "beta", "leaf"), "in-beta")
	if err := os.MkdirAll(filepath.Join(hub, "alpha"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := st.Restore(dest, false); err != nil {
		t.Fatalf("hubDest alpha/leaf is free: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(hub, "alpha", "leaf", "SKILL.md"))
	if err != nil || string(b) != "from-alpha" {
		t.Fatalf("restored=%q err=%v", b, err)
	}
	b, err = os.ReadFile(filepath.Join(hub, "beta", "leaf", "SKILL.md"))
	if err != nil || string(b) != "in-beta" {
		t.Fatalf("other group should be untouched: %q err=%v", b, err)
	}
}

func TestRestoreOverwriteOnlyMovesHubDest(t *testing.T) {
	hub := t.TempDir()
	st := New(hub)
	src := filepath.Join(hub, "alpha", "leaf")
	writeSkill(t, src, "from-trash")
	dest, err := st.Move(src)
	if err != nil {
		t.Fatal(err)
	}
	writeSkill(t, filepath.Join(hub, "alpha", "leaf"), "occupying-dest")
	writeSkill(t, filepath.Join(hub, "beta", "leaf"), "in-beta")
	if err := st.Restore(dest, true); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(hub, "alpha", "leaf", "SKILL.md"))
	if err != nil || string(b) != "from-trash" {
		t.Fatalf("restored=%q err=%v", b, err)
	}
	b, err = os.ReadFile(filepath.Join(hub, "beta", "leaf", "SKILL.md"))
	if err != nil || string(b) != "in-beta" {
		t.Fatalf("overwrite must not trash other group: %q err=%v", b, err)
	}
}
