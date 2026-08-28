package export

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"SkillsManager/internal/domain"
)

func TestEnabledSkillIDs(t *testing.T) {
	entries := []domain.SkillEntry{
		{
			ID: "a",
			Locations: []domain.SkillLocation{
				{ToolID: "cursor", Kind: domain.KindSymlink},
			},
		},
		{
			ID: "b",
			Locations: []domain.SkillLocation{
				{ToolID: "cursor", Kind: domain.KindRealCopy},
			},
		},
		{
			ID: "c",
			Locations: []domain.SkillLocation{
				{ToolID: "cursor", Kind: domain.KindBrokenLink},
			},
		},
		{
			ID: "d",
			Locations: []domain.SkillLocation{
				{ToolID: "claude", Kind: domain.KindSymlink},
			},
		},
	}
	ids := EnabledSkillIDs(entries, "cursor")
	if len(ids) != 2 || ids[0] != "a" || ids[1] != "b" {
		t.Fatalf("ids=%v", ids)
	}
}

func TestUniqueZipPathCollision(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 7, 23, 15, 30, 45, 0, time.Local)
	base := UniqueZipPath(dir, "cursor", now)
	wantBase := filepath.Join(dir, "cursor-20260723-153045.zip")
	if base != wantBase {
		t.Fatalf("got %s want %s", base, wantBase)
	}
	if err := os.WriteFile(base, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	second := UniqueZipPath(dir, "cursor", now)
	want2 := filepath.Join(dir, "cursor-20260723-153045-2.zip")
	if second != want2 {
		t.Fatalf("got %s want %s", second, want2)
	}
}

func TestExportPacksHubDirs(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	exportDir := filepath.Join(root, "export")
	skillA := filepath.Join(hub, domain.DefaultGroup, "skill-a")
	if err := os.MkdirAll(skillA, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skillA, "SKILL.md"), []byte("name: a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	entries := []domain.SkillEntry{
		{
			ID:      "skill-a",
			HubPath: skillA,
			Locations: []domain.SkillLocation{
				{ToolID: "cursor", Kind: domain.KindSymlink},
			},
		},
		{
			ID: "missing",
			Locations: []domain.SkillLocation{
				{ToolID: "cursor", Kind: domain.KindSymlink},
			},
		},
	}
	now := time.Date(2026, 7, 23, 15, 30, 45, 0, time.Local)
	res, err := Export(hub, exportDir, "cursor", entries, now)
	if err != nil {
		t.Fatal(err)
	}
	if res.Exported != 1 || res.Skipped != 1 {
		t.Fatalf("res=%+v", res)
	}
	if _, err := os.Stat(res.ZipPath); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.OpenReader(res.ZipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	joined := strings.Join(names, "\n")
	if !strings.Contains(joined, "skill-a/SKILL.md") {
		t.Fatalf("zip names=%v", names)
	}
}

func TestExportEmptyNoFile(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	exportDir := filepath.Join(root, "export")
	_ = os.MkdirAll(hub, 0o755)
	_, err := Export(hub, exportDir, "cursor", nil, time.Now())
	if err == nil || !strings.Contains(err.Error(), "没有已启用的 skill") {
		t.Fatalf("err=%v", err)
	}
	ents, _ := os.ReadDir(exportDir)
	if len(ents) != 0 {
		t.Fatalf("should not write empty zip, got %d files", len(ents))
	}
}
