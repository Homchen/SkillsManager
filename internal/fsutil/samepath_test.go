package fsutil

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestSamePathEmpty(t *testing.T) {
	if SamePath("", "") || SamePath("  ", "  ") || SamePath("a", "") || SamePath("", "a") {
		t.Fatal("empty or whitespace-only paths must not be equal")
	}
}

func TestSamePathAbsAndRelative(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "file.txt")
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !SamePath(p, p) {
		t.Fatal("identical path")
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	rel, err := filepath.Rel(cwd, p)
	if err != nil {
		t.Skipf("cannot relativize across volumes: %v", err)
	}
	if !SamePath(rel, p) {
		t.Fatalf("relative %q should match abs %q", rel, p)
	}
}

func TestSamePathCase(t *testing.T) {
	if runtime.GOOS == "windows" {
		if !SamePath(`C:\SkillsHub\Demo`, `c:\skillshub\demo`) {
			t.Fatal("windows paths should match ignoring case")
		}
		return
	}
	if SamePath("/tmp/SkillsHub/Demo", "/tmp/skillshub/demo") {
		t.Fatal("non-windows paths should be case-sensitive")
	}
}

func TestSamePathDoesNotFollowSymlink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	if err := os.WriteFile(target, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink(target, link); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("symlink unavailable: %v", err)
		}
		t.Fatal(err)
	}
	if SamePath(target, link) {
		t.Fatal("symlink and its target must not compare equal")
	}
}
