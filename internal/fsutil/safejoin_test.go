package fsutil

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSafeJoinUnderRejectsDotDot(t *testing.T) {
	root := t.TempDir()
	if _, err := SafeJoinUnder(root, "../outside.txt"); err == nil || !strings.Contains(err.Error(), "路径") {
		t.Fatalf("expected rejection, got %v", err)
	}
}

func TestSafeJoinUnderAllowsMissingLeaf(t *testing.T) {
	root := t.TempDir()
	got, err := SafeJoinUnder(root, "notes/new.md")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, "notes", "new.md")
	if filepath.Clean(got) != filepath.Clean(want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestSafeJoinUnderRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secret, []byte("top-secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	escape := filepath.Join(root, "escape")
	if err := os.Symlink(outside, escape); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("symlink unavailable: %v", err)
		}
		t.Fatal(err)
	}
	if _, err := SafeJoinUnder(root, "escape/secret.txt"); err == nil || !strings.Contains(err.Error(), "路径越界") {
		t.Fatalf("expected symlink escape rejection, got %v", err)
	}
}

func TestFindHubSkillDirDefaultAndCustomGroup(t *testing.T) {
	hub := t.TempDir()
	def := filepath.Join(hub, "default", "alpha")
	custom := filepath.Join(hub, "team", "beta")
	for _, dir := range []string{def, custom} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	got, ok := FindHubSkillDir(hub, "alpha")
	if !ok || filepath.Clean(got) != filepath.Clean(def) {
		t.Fatalf("alpha=%q ok=%v", got, ok)
	}
	got, ok = FindHubSkillDir(hub, "beta")
	if !ok || filepath.Clean(got) != filepath.Clean(custom) {
		t.Fatalf("beta=%q ok=%v", got, ok)
	}
	if _, ok := FindHubSkillDir(hub, "../alpha"); ok {
		t.Fatal("must reject traversal id")
	}
}

func TestFindHubSkillDirPeelsNestedRelSkillID(t *testing.T) {
	hub := t.TempDir()
	leaf := filepath.Join(hub, "team", "child")
	if err := os.MkdirAll(leaf, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(leaf, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, ok := FindHubSkillDir(hub, "parent/child")
	if !ok || filepath.Clean(got) != filepath.Clean(leaf) {
		t.Fatalf("nested id=%q ok=%v want %q", got, ok, leaf)
	}
	if _, ok := FindHubSkillDir(hub, "parent/../child"); ok {
		t.Fatal("must still reject traversal nested id")
	}
}
