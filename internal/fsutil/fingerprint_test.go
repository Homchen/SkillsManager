package fsutil

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func writeTreeFile(t *testing.T, dir, rel, body string) {
	t.Helper()
	path := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSkillDirsContentDifferIdentical(t *testing.T) {
	a := t.TempDir()
	b := t.TempDir()
	writeTreeFile(t, a, "SKILL.md", "same")
	writeTreeFile(t, b, "SKILL.md", "same")
	if SkillDirsContentDiffer([]string{a, b}) {
		t.Fatal("identical trees should not differ")
	}
}

func TestSkillDirsContentDifferContent(t *testing.T) {
	a := t.TempDir()
	b := t.TempDir()
	writeTreeFile(t, a, "SKILL.md", "left")
	writeTreeFile(t, b, "SKILL.md", "right")
	if !SkillDirsContentDiffer([]string{a, b}) {
		t.Fatal("different content should differ")
	}
}

func TestSkillDirsContentDifferFewerThanTwo(t *testing.T) {
	if SkillDirsContentDiffer(nil) || SkillDirsContentDiffer([]string{t.TempDir()}) {
		t.Fatal("fewer than two roots should not differ")
	}
}

func TestSkillDirsContentDifferMissingRoot(t *testing.T) {
	a := t.TempDir()
	writeTreeFile(t, a, "SKILL.md", "x")
	missing := filepath.Join(a, "nope")
	if !SkillDirsContentDiffer([]string{a, missing}) {
		t.Fatal("unreadable root should count as different")
	}
}

func TestSkillDirsContentDifferSkipsIgnoredDirs(t *testing.T) {
	a := t.TempDir()
	b := t.TempDir()
	writeTreeFile(t, a, "SKILL.md", "x")
	writeTreeFile(t, b, "SKILL.md", "x")
	writeTreeFile(t, b, "node_modules/pkg/index.js", "ignored")
	if SkillDirsContentDiffer([]string{a, b}) {
		t.Fatal("ShouldSkipDir trees should not count as different")
	}
}

func TestSkillDirsContentDifferIgnoresSymlinks(t *testing.T) {
	a := t.TempDir()
	b := t.TempDir()
	writeTreeFile(t, a, "SKILL.md", "x")
	writeTreeFile(t, b, "SKILL.md", "x")
	if err := os.Symlink("SKILL.md", filepath.Join(b, "alias")); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("symlink unavailable: %v", err)
		}
		t.Fatal(err)
	}
	if SkillDirsContentDiffer([]string{a, b}) {
		t.Fatal("file symlinks should be ignored by fingerprint")
	}
}

func TestSkillDirsStatDifferIdenticalDifferentMtime(t *testing.T) {
	a := t.TempDir()
	b := t.TempDir()
	writeTreeFile(t, a, "SKILL.md", "same")
	writeTreeFile(t, a, "notes.md", "body")
	writeTreeFile(t, b, "SKILL.md", "same")
	writeTreeFile(t, b, "notes.md", "body")
	old := time.Date(2000, 1, 2, 3, 4, 5, 0, time.UTC)
	if err := os.Chtimes(filepath.Join(b, "SKILL.md"), old, old); err != nil {
		t.Fatal(err)
	}
	if SkillDirsStatDiffer([]string{a, b}) {
		t.Fatal("stat fingerprint must ignore mtime")
	}
}

func TestSkillDirsStatDifferSkillMDContent(t *testing.T) {
	a := t.TempDir()
	b := t.TempDir()
	writeTreeFile(t, a, "SKILL.md", "left")
	writeTreeFile(t, b, "SKILL.md", "right")
	if !SkillDirsStatDiffer([]string{a, b}) {
		t.Fatal("different SKILL.md content should differ even at the same size")
	}
}

func TestSkillDirsStatDifferLargeAttachmentSizeOnly(t *testing.T) {
	a := t.TempDir()
	b := t.TempDir()
	writeTreeFile(t, a, "SKILL.md", "same")
	writeTreeFile(t, b, "SKILL.md", "same")
	blobA := bytes.Repeat([]byte("A"), 4096)
	blobB := bytes.Repeat([]byte("B"), 4096)
	writeTreeFile(t, a, "assets/blob.bin", string(blobA))
	writeTreeFile(t, b, "assets/blob.bin", string(blobB))
	if SkillDirsStatDiffer([]string{a, b}) {
		t.Fatal("same-size non-SKILL.md files should not be hashed")
	}
	if !SkillDirsContentDiffer([]string{a, b}) {
		t.Fatal("full content fingerprint should still see the blob difference")
	}
}

func TestSkillDirsStatDifferFewerThanTwo(t *testing.T) {
	if SkillDirsStatDiffer(nil) || SkillDirsStatDiffer([]string{t.TempDir()}) {
		t.Fatal("fewer than two roots should not differ")
	}
}

func TestSkillDirsStatDifferMissingRoot(t *testing.T) {
	a := t.TempDir()
	writeTreeFile(t, a, "SKILL.md", "x")
	missing := filepath.Join(a, "nope")
	if !SkillDirsStatDiffer([]string{a, missing}) {
		t.Fatal("unreadable root should count as different")
	}
}
