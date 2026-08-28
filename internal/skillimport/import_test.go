package skillimport

import (
	"archive/zip"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
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

func TestImportSingleSkillDir(t *testing.T) {
	hub := t.TempDir()
	srcRoot := t.TempDir()
	src := filepath.Join(srcRoot, "demo-skill")
	writeSkill(t, src, "---\nname: Demo\n---\nbody\n")

	res, err := Import(hub, []string{src})
	if err != nil {
		t.Fatal(err)
	}
	if res.Imported != 1 || res.Skipped != 0 || res.Failed != 0 {
		t.Fatalf("res=%+v", res)
	}
	dst := filepath.Join(hub, domain.DefaultGroup, "demo-skill", "SKILL.md")
	b, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "---\nname: Demo\n---\nbody\n" {
		t.Fatalf("content=%q", b)
	}
	// source untouched
	if !fsutil.IsSkillDir(src) {
		t.Fatal("source should remain")
	}
}

func TestImportSkipsExisting(t *testing.T) {
	hub := t.TempDir()
	writeSkill(t, filepath.Join(hub, domain.DefaultGroup, "demo"), "---\nname: Old\n---\n")
	src := filepath.Join(t.TempDir(), "demo")
	writeSkill(t, src, "---\nname: New\n---\n")

	res, err := Import(hub, []string{src})
	if err != nil {
		t.Fatal(err)
	}
	if res.Imported != 0 || res.Skipped != 1 {
		t.Fatalf("res=%+v items=%+v", res, res.Items)
	}
	b, _ := os.ReadFile(filepath.Join(hub, domain.DefaultGroup, "demo", "SKILL.md"))
	if string(b) != "---\nname: Old\n---\n" {
		t.Fatalf("should not overwrite, got %q", b)
	}
}

func TestImportParentDirDirectChildren(t *testing.T) {
	hub := t.TempDir()
	parent := t.TempDir()
	writeSkill(t, filepath.Join(parent, "a"), "---\nname: A\n---\n")
	writeSkill(t, filepath.Join(parent, "b"), "---\nname: B\n---\n")
	// nested deeper — ignored
	writeSkill(t, filepath.Join(parent, "nest", "c"), "---\nname: C\n---\n")

	res, err := Import(hub, []string{parent})
	if err != nil {
		t.Fatal(err)
	}
	if res.Imported != 2 {
		t.Fatalf("imported=%d items=%+v", res.Imported, res.Items)
	}
	if !fsutil.IsSkillDir(filepath.Join(hub, domain.DefaultGroup, "a")) {
		t.Fatal("missing a")
	}
	if !fsutil.IsSkillDir(filepath.Join(hub, domain.DefaultGroup, "b")) {
		t.Fatal("missing b")
	}
	if fsutil.IsSkillDir(filepath.Join(hub, domain.DefaultGroup, "c")) {
		t.Fatal("nested c should not import")
	}
}

func TestImportZip(t *testing.T) {
	hub := t.TempDir()
	zipPath := filepath.Join(t.TempDir(), "pack.zip")
	if err := writeTestZip(zipPath, map[string]string{
		"skill-a/SKILL.md": "---\nname: A\n---\n",
		"skill-a/extra.md": "x",
		"skill-b/SKILL.md": "---\nname: B\n---\n",
		"deep/x/SKILL.md":  "ignore",
	}); err != nil {
		t.Fatal(err)
	}

	res, err := Import(hub, []string{zipPath})
	if err != nil {
		t.Fatal(err)
	}
	if res.Imported != 2 {
		t.Fatalf("imported=%d items=%+v", res.Imported, res.Items)
	}
	if !fsutil.IsSkillDir(filepath.Join(hub, domain.DefaultGroup, "skill-a")) {
		t.Fatal("missing skill-a")
	}
	if _, err := os.Stat(filepath.Join(hub, domain.DefaultGroup, "skill-a", "extra.md")); err != nil {
		t.Fatal(err)
	}
	if fsutil.IsSkillDir(filepath.Join(hub, domain.DefaultGroup, "deep")) {
		t.Fatal("deep should not import")
	}
}

func TestImportSkillPackage(t *testing.T) {
	hub := t.TempDir()
	skillPath := filepath.Join(t.TempDir(), "c4-codebase-architecture.skill")
	if err := writeTestZip(skillPath, map[string]string{
		"c4-codebase-architecture/SKILL.md": "---\nname: c4-codebase-architecture\n---\nbody\n",
		"c4-codebase-architecture/refs.md":  "ref",
	}); err != nil {
		t.Fatal(err)
	}

	res, err := Import(hub, []string{skillPath})
	if err != nil {
		t.Fatal(err)
	}
	if res.Imported != 1 || res.Failed != 0 {
		t.Fatalf("res=%+v items=%+v", res, res.Items)
	}
	dst := filepath.Join(hub, domain.DefaultGroup, "c4-codebase-architecture")
	if !fsutil.IsSkillDir(dst) {
		t.Fatal("missing imported skill dir")
	}
	if _, err := os.Stat(filepath.Join(dst, "refs.md")); err != nil {
		t.Fatal(err)
	}
}

func TestImportZipRejectsOversizedFile(t *testing.T) {
	hub := t.TempDir()
	zipPath := filepath.Join(t.TempDir(), "bomb.zip")
	f, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	w, err := zw.Create("bomb/SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	big := make([]byte, maxZipFileBytes+1)
	for i := range big {
		big[i] = 'a'
	}
	if _, err := w.Write(big); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	res, err := Import(hub, []string{zipPath})
	if err != nil {
		t.Fatal(err)
	}
	if res.Failed != 1 || res.Imported != 0 {
		t.Fatalf("want failed import, got %+v items=%+v", res, res.Items)
	}
	if res.Items[0].Reason == "" {
		t.Fatal("expected failure reason")
	}
}

func writeTestZip(path string, files map[string]string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			_ = zw.Close()
			return err
		}
		if _, err := w.Write([]byte(body)); err != nil {
			_ = zw.Close()
			return err
		}
	}
	return zw.Close()
}

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

func TestImportRejectsFileSymlink(t *testing.T) {
	hub := t.TempDir()
	secret := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(secret, []byte("OPENAI_API_KEY=sk-secret\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(t.TempDir(), "leaky-skill")
	writeSkill(t, src, "---\nname: Leaky\n---\n")
	link := filepath.Join(src, "stolen.env")
	if err := os.Symlink(secret, link); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}

	res, err := Import(hub, []string{src})
	if err != nil {
		t.Fatal(err)
	}
	if res.Imported != 0 || res.Failed != 1 {
		t.Fatalf("want failed import, got %+v items=%+v", res, res.Items)
	}
	if res.Items[0].Reason == "" || !strings.Contains(res.Items[0].Reason, "符号链接") {
		t.Fatalf("reason=%q", res.Items[0].Reason)
	}
	dst := filepath.Join(hub, domain.DefaultGroup, "leaky-skill")
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatal("failed import must not leave a hub skill")
	}
	stolen := filepath.Join(dst, "stolen.env")
	if b, err := os.ReadFile(stolen); err == nil && strings.Contains(string(b), "sk-secret") {
		t.Fatal("must not copy symlink target contents into hub")
	}
}
