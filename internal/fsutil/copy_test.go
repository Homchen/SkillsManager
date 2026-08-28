package fsutil

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func skipIfSymlinkUnavailable(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		return
	}
	if runtime.GOOS == "windows" {
		t.Skipf("symlink unavailable: %v", err)
	}
	t.Fatal(err)
}

func TestCopyTreeFileCreatesParents(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "src.txt")
	if err := os.WriteFile(src, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(root, "nested", "out.txt")
	if err := CopyTree(src, dst); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "hello" {
		t.Fatalf("got %q", b)
	}
}

func TestCopyTreeDirectory(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "src")
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "a.txt"), []byte("A"), 0o644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(root, "dst")
	if err := CopyTree(src, dst); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dst, "sub", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "A" {
		t.Fatalf("got %q", b)
	}
}

func TestCopyTreePreservesSymlink(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "src")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(src, "rel")
	if err := os.Symlink("missing-target", link); err != nil {
		skipIfSymlinkUnavailable(t, err)
	}
	dst := filepath.Join(root, "dst")
	if err := CopyTree(src, dst); err != nil {
		t.Fatal(err)
	}
	got, err := os.Readlink(filepath.Join(dst, "rel"))
	if err != nil {
		t.Fatal(err)
	}
	if got != "missing-target" {
		t.Fatalf("link target=%q", got)
	}
}

func TestCopyTreeRootSymlink(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target.txt")
	if err := os.WriteFile(target, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(root, "link")
	if err := os.Symlink(target, src); err != nil {
		skipIfSymlinkUnavailable(t, err)
	}
	dst := filepath.Join(root, "copied-link")
	if err := CopyTree(src, dst); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Lstat(dst)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("expected symlink at destination")
	}
	got, err := os.Readlink(dst)
	if err != nil {
		t.Fatal(err)
	}
	if got != target {
		t.Fatalf("link target=%q want %q", got, target)
	}
}
