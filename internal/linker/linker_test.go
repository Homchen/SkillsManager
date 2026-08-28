package linker

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"SkillsManager/internal/fsutil"
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

func TestEnsureSymlinkIdempotent(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "hub", "demo")
	link := filepath.Join(root, "tool", "demo")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "SKILL.md"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := EnsureSymlink(link, target); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if err := EnsureSymlink(link, target); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Lstat(link)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("not a symlink")
	}
	got, err := os.Readlink(link)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := filepath.Abs(target)
	gotAbs, _ := filepath.Abs(got)
	if !fsutil.SamePath(gotAbs, want) {
		t.Fatalf("target %q want %q", gotAbs, want)
	}
}

func TestEnsureSymlinkRelativeIndependentOfCwd(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "hub", "demo")
	link := filepath.Join(root, "tool", "demo")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "SKILL.md"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	rel, err := filepath.Rel(filepath.Dir(link), target)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(rel, link); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	t.Chdir(t.TempDir())
	if err := EnsureSymlink(link, target); err != nil {
		t.Fatal(err)
	}
	got, err := os.Readlink(link)
	if err != nil {
		t.Fatal(err)
	}
	if got != rel {
		t.Fatalf("rewrote relative link %q to %q", rel, got)
	}
}

func TestEnsureSymlinkWindowsCaseInsensitive(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows path case only")
	}
	root := t.TempDir()
	target := filepath.Join(root, "hub", "demo")
	link := filepath.Join(root, "tool", "demo")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := EnsureSymlink(link, target); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	before, err := os.Readlink(link)
	if err != nil {
		t.Fatal(err)
	}
	abs, err := filepath.Abs(target)
	if err != nil {
		t.Fatal(err)
	}
	alt := strings.ToLower(abs)
	if alt == abs {
		alt = strings.ToUpper(abs)
	}
	if alt == abs {
		t.Skip("cannot flip path case")
	}
	if err := EnsureSymlink(link, alt); err != nil {
		t.Fatal(err)
	}
	got, err := os.Readlink(link)
	if err != nil {
		t.Fatal(err)
	}
	if got != before {
		t.Fatalf("rewrote link for case-only change: %q -> %q", before, got)
	}
}
