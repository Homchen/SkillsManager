package export

import (
	"archive/zip"
	"bytes"
	"io"
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

func writeHubSkill(t *testing.T, hub, group, id, body string) string {
	t.Helper()
	dir := filepath.Join(hub, group, id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func zipNames(t *testing.T, zipPath string) []string {
	t.Helper()
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	return names
}

func innerZipEntryNames(t *testing.T, outerPath, entry string) []string {
	t.Helper()
	zr, err := zip.OpenReader(outerPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.Name != entry {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		inner, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
		if err != nil {
			t.Fatal(err)
		}
		var names []string
		for _, zf := range inner.File {
			names = append(names, zf.Name)
		}
		return names
	}
	t.Fatalf("outer zip missing %s; have %v", entry, zipNames(t, outerPath))
	return nil
}

func TestUniqueDateZipPath(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 8, 28, 15, 30, 45, 0, time.Local)
	got := UniqueDateZipPath(dir, "skill-export", now)
	want := filepath.Join(dir, "skill-export-20260828.zip")
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
	if err := os.WriteFile(got, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	second := UniqueDateZipPath(dir, "skill-export", now)
	want2 := filepath.Join(dir, "skill-export-20260828-2.zip")
	if second != want2 {
		t.Fatalf("got %s want %s", second, want2)
	}
}

func TestUniqueNamedZipPathCollision(t *testing.T) {
	dir := t.TempDir()
	got := UniqueNamedZipPath(dir, "my-skill")
	want := filepath.Join(dir, "my-skill.zip")
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
	if err := os.WriteFile(got, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	second := UniqueNamedZipPath(dir, "my-skill")
	want2 := filepath.Join(dir, "my-skill-2.zip")
	if second != want2 {
		t.Fatalf("got %s want %s", second, want2)
	}
}

func TestExportSelectedSingleNamedAfterSkill(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	exportDir := filepath.Join(root, "export")
	skillA := writeHubSkill(t, hub, domain.DefaultGroup, "skill-a", "name: a\n")
	writeHubSkill(t, hub, domain.DefaultGroup, "skill-b", "name: b\n")
	entries := []domain.SkillEntry{
		{ID: "skill-a", HubPath: skillA},
	}
	now := time.Date(2026, 8, 28, 9, 0, 0, 0, time.Local)
	res, err := ExportSelected(hub, exportDir, []string{"skill-a"}, entries, now)
	if err != nil {
		t.Fatal(err)
	}
	if res.Exported != 1 || res.Skipped != 0 {
		t.Fatalf("res=%+v", res)
	}
	wantZip := filepath.Join(exportDir, "skill-a.zip")
	if res.ZipPath != wantZip {
		t.Fatalf("zip=%s want %s", res.ZipPath, wantZip)
	}
	names := strings.Join(zipNames(t, res.ZipPath), "\n")
	if !strings.Contains(names, "skill-a/SKILL.md") {
		t.Fatalf("zip names missing skill-a: %s", names)
	}
	if strings.Contains(names, "skill-b/") {
		t.Fatalf("single export should not include other skills: %s", names)
	}
}

func TestExportSelectedMultipleUsesDatedPack(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	exportDir := filepath.Join(root, "export")
	skillA := writeHubSkill(t, hub, domain.DefaultGroup, "skill-a", "name: a\n")
	skillB := writeHubSkill(t, hub, "work", "skill-b", "name: b\n")
	entries := []domain.SkillEntry{
		{ID: "skill-a", HubPath: skillA},
		{ID: "skill-b", HubPath: skillB},
	}
	now := time.Date(2026, 8, 28, 9, 0, 0, 0, time.Local)
	res, err := ExportSelected(hub, exportDir, []string{"skill-b", "skill-a", "skill-a", " "}, entries, now)
	if err != nil {
		t.Fatal(err)
	}
	if res.Exported != 2 || res.Skipped != 0 {
		t.Fatalf("res=%+v", res)
	}
	wantZip := filepath.Join(exportDir, "skill-export-20260828.zip")
	if res.ZipPath != wantZip {
		t.Fatalf("zip=%s want %s", res.ZipPath, wantZip)
	}
	names := zipNames(t, res.ZipPath)
	joined := strings.Join(names, "\n")
	if !strings.Contains(joined, "skill-a.zip") || !strings.Contains(joined, "skill-b.zip") {
		t.Fatalf("pack should contain per-skill zips: %v", names)
	}
	if strings.Contains(joined, "SKILL.md") {
		t.Fatalf("pack should not contain unpacked skill dirs: %v", names)
	}
	innerA := strings.Join(innerZipEntryNames(t, res.ZipPath, "skill-a.zip"), "\n")
	innerB := strings.Join(innerZipEntryNames(t, res.ZipPath, "skill-b.zip"), "\n")
	if !strings.Contains(innerA, "skill-a/SKILL.md") {
		t.Fatalf("skill-a.zip contents=%s", innerA)
	}
	if !strings.Contains(innerB, "skill-b/SKILL.md") {
		t.Fatalf("skill-b.zip contents=%s", innerB)
	}
}

func TestExportSelectedEmptyNoFile(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	exportDir := filepath.Join(root, "export")
	_ = os.MkdirAll(hub, 0o755)
	_, err := ExportSelected(hub, exportDir, nil, nil, time.Now())
	if err == nil || !strings.Contains(err.Error(), "未选择 skill") {
		t.Fatalf("err=%v", err)
	}
	ents, _ := os.ReadDir(exportDir)
	if len(ents) != 0 {
		t.Fatalf("should not write empty zip, got %d files", len(ents))
	}
}

func TestExportSelectedAllMissing(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	exportDir := filepath.Join(root, "export")
	_ = os.MkdirAll(hub, 0o755)
	_, err := ExportSelected(hub, exportDir, []string{"gone"}, nil, time.Now())
	if err == nil || !strings.Contains(err.Error(), "未找到可导出的源仓目录") {
		t.Fatalf("err=%v", err)
	}
	ents, _ := os.ReadDir(exportDir)
	if len(ents) != 0 {
		t.Fatalf("should not write empty zip, got %d files", len(ents))
	}
}
