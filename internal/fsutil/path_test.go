package fsutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeSkillID(t *testing.T) {
	got := NormalizeSkillID(`huashu-nuwa\examples\foo`)
	if got != "huashu-nuwa/examples/foo" {
		t.Fatalf("got %q", got)
	}
}

func TestIsSkillDir(t *testing.T) {
	dir := t.TempDir()
	skill := filepath.Join(dir, "demo")
	if err := os.MkdirAll(skill, 0o755); err != nil {
		t.Fatal(err)
	}
	if IsSkillDir(skill) {
		t.Fatal("expected false without SKILL.md")
	}
	if err := os.WriteFile(filepath.Join(skill, "SKILL.md"), []byte("---\nname: demo\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !IsSkillDir(skill) {
		t.Fatal("expected true")
	}
}

func TestShouldSkipDir(t *testing.T) {
	for _, name := range []string{
		"node_modules", "_trash", ".git", ".system", ".bun",
		"AppData", "Temp", "tmp", ".cache", ".paddlex", ".huggingface",
	} {
		if !ShouldSkipDir(name) {
			t.Fatalf("expected skip %q", name)
		}
	}
	if !ShouldSkipDir(".evaluation-zh-CN.__translating-1909352060") {
		t.Fatal("expected translating staging dir to be skipped")
	}
	if !ShouldSkipDir(".evaluation-zh-CN.__backup-123") {
		t.Fatal("expected backup staging dir to be skipped")
	}
	if ShouldSkipDir("brainstorming") || ShouldSkipDir("evaluation-zh-CN") {
		t.Fatal("should not skip skill name")
	}
}
