package organizer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/linker"
	"SkillsManager/internal/trash"
)

func TestFindAndRestoreOrphanLinks(t *testing.T) {
	home := t.TempDir()
	hub := filepath.Join(home, ".skillsmanager", "skills")
	tool := filepath.Join(home, ".cursor", "skills")
	misplaced := filepath.Join(hub, "Projects", "nested", "demo")
	if err := os.MkdirAll(misplaced, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(misplaced, "SKILL.md"), []byte("body"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tool, 0o755); err != nil {
		t.Fatal(err)
	}
	// Legitimate tool link → should NOT be listed.
	if err := linker.EnsureSymlink(filepath.Join(tool, "demo"), misplaced); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	// Orphan link outside tools at home/<rel-from-hub> → should be listed.
	orphanLink := filepath.Join(home, "Projects", "nested", "demo")
	if err := os.MkdirAll(filepath.Dir(orphanLink), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := linker.EnsureSymlink(orphanLink, misplaced); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}

	cfg := config.Config{
		HubPath: hub,
		Tools:   []config.ToolMapping{{ID: "cursor", Path: tool, Enabled: true}},
	}
	items, err := FindRestorableOrphanLinks(home, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("items=%+v want 1 orphan link", items)
	}
	if items[0].SkillID != "demo" {
		t.Fatalf("skillId=%q", items[0].SkillID)
	}

	report, err := RestoreOrphanLinks(items, []string{items[0].LinkPath}, cfg, trash.New(hub))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Succeeded) != 1 || len(report.Failed) != 0 {
		t.Fatalf("report=%+v", report)
	}
	fi, err := os.Lstat(orphanLink)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		t.Fatal("orphan path should be a real directory again")
	}
	b, err := os.ReadFile(filepath.Join(orphanLink, "SKILL.md"))
	if err != nil || string(b) != "body" {
		t.Fatalf("content=%q err=%v", b, err)
	}
	if _, err := os.Stat(misplaced); !os.IsNotExist(err) {
		t.Fatal("misplaced hub path should be gone after restore")
	}
}

func TestAbsCleanPreferLongUnderHub(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	skill := filepath.Join(hub, "Projects", "demo")
	if err := os.MkdirAll(skill, 0o755); err != nil {
		t.Fatal(err)
	}
	if !pathUnderRootFold(skill, []string{hub}) {
		t.Fatal("skill should be under hub")
	}
}

// Regression: restore must Lstat the same path that was accepted as a symlink.
// Storing an EvalSymlinks-normalized path (parent followed into the hub target)
// caused mass "已不是符号链接" failures on restore.
func TestRestoreCandidateLinkPathIsSymlinkNotTarget(t *testing.T) {
	home := t.TempDir()
	hub := filepath.Join(home, ".skillsmanager", "skills")
	misplaced := filepath.Join(hub, "Projects", "nested", "demo")
	if err := os.MkdirAll(misplaced, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(misplaced, "SKILL.md"), []byte("body"), 0o644); err != nil {
		t.Fatal(err)
	}
	orphanLink := filepath.Join(home, "Projects", "nested", "demo")
	if err := os.MkdirAll(filepath.Dir(orphanLink), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := linker.EnsureSymlink(orphanLink, misplaced); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}

	item, ok := restoreCandidateAt(orphanLink, misplaced, absCleanPreferLong(hub), nil)
	if !ok {
		t.Fatal("expected restorable orphan")
	}
	fi, err := os.Lstat(item.LinkPath)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("LinkPath %q must remain a symlink (not resolved target %q)", item.LinkPath, item.TargetPath)
	}
	if samePathNoEval(item.LinkPath, item.TargetPath) {
		t.Fatalf("LinkPath collapsed onto TargetPath: %q", item.LinkPath)
	}

	// Simulate the old bug: restore against the hub target path.
	bad := domain.RestoreOrphanItem{
		LinkPath:   item.TargetPath,
		TargetPath: item.TargetPath,
		SkillID:    item.SkillID,
	}
	err = restoreOneOrphanLink(bad, absCleanPreferLong(hub), trash.New(hub))
	if err == nil {
		t.Fatal("hub target path should be rejected")
	}
	if !strings.Contains(err.Error(), "已不是符号链接") && !strings.Contains(err.Error(), "恢复路径无效") {
		t.Fatalf("hub target path should fail clearly, got %v", err)
	}

	if err := restoreOneOrphanLink(item, absCleanPreferLong(hub), trash.New(hub)); err != nil {
		t.Fatal(err)
	}
}

func TestRestoreOrphanWhenLinkMissingDoesNotMoveHub(t *testing.T) {
	home := t.TempDir()
	hub := filepath.Join(home, ".skillsmanager", "skills")
	misplaced := filepath.Join(hub, "Projects", "nested", "demo")
	if err := os.MkdirAll(misplaced, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(misplaced, "SKILL.md"), []byte("body"), 0o644); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(home, "Projects", "nested", "demo")
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		t.Fatal(err)
	}
	item := domain.RestoreOrphanItem{
		LinkPath:   dest,
		TargetPath: misplaced,
		SkillID:    "demo",
	}
	err := restoreOneOrphanLink(item, absCleanPreferLong(hub), trash.New(hub))
	if err == nil {
		t.Fatal("missing symlink should not move hub skill")
	}
	if !strings.Contains(err.Error(), "符号链接已不存在") {
		t.Fatalf("err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(misplaced, "SKILL.md")); err != nil {
		t.Fatal("hub skill must remain when the orphan link is gone")
	}
}
