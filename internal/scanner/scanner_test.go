package scanner

import (
	"os"
	"path/filepath"
	"testing"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/linker"
)

func TestScanClassifiesLocations(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	tool := filepath.Join(root, "cursor-skills")
	skillHub := filepath.Join(hub, "default", "demo")
	if err := os.MkdirAll(skillHub, 0o755); err != nil {
		t.Fatal(err)
	}
	content := []byte("---\nname: Demo\ndescription: d\n---\nbody\n")
	if err := os.WriteFile(filepath.Join(skillHub, "SKILL.md"), content, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tool, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := linker.EnsureSymlink(filepath.Join(tool, "demo"), skillHub); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	// real copy elsewhere
	other := filepath.Join(root, "claude-skills", "demo")
	if err := os.MkdirAll(other, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(other, "SKILL.md"), []byte("---\nname: Demo\n---\ndiff\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "skills", Path: hub, Enabled: true, IsHub: true},
			{ID: "cursor", Path: tool, Enabled: true},
			{ID: "claude", Path: filepath.Join(root, "claude-skills"), Enabled: true},
		},
	}
	entries, err := Scan(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries=%d", len(entries))
	}
	e := entries[0]
	if e.ID != "demo" || e.Name != "Demo" {
		t.Fatalf("entry=%+v", e)
	}
	if e.Group != "default" {
		t.Fatalf("group=%q want=default", e.Group)
	}
	kinds := map[domain.LocationKind]int{}
	for _, loc := range e.Locations {
		kinds[loc.Kind]++
	}
	if kinds[domain.KindHub] != 1 || kinds[domain.KindSymlink] != 1 || kinds[domain.KindRealCopy] != 1 {
		t.Fatalf("kinds=%v locs=%+v", kinds, e.Locations)
	}
	// hub + symlink + differing real_copy => conflict
	if e.Status != domain.StatusConflict {
		t.Fatalf("status=%s want=%s", e.Status, domain.StatusConflict)
	}
}

func TestScanIdenticalRealCopiesNotConflict(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	skillHub := filepath.Join(hub, "default", "demo")
	if err := os.MkdirAll(skillHub, 0o755); err != nil {
		t.Fatal(err)
	}
	content := []byte("---\nname: Demo\ndescription: d\n---\nbody\n")
	if err := os.WriteFile(filepath.Join(skillHub, "SKILL.md"), content, 0o644); err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(root, "claude-skills", "demo")
	if err := os.MkdirAll(other, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(other, "SKILL.md"), content, 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "skills", Path: hub, Enabled: true, IsHub: true},
			{ID: "claude", Path: filepath.Join(root, "claude-skills"), Enabled: true},
		},
	}
	entries, err := Scan(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries=%d", len(entries))
	}
	if entries[0].Group != "default" {
		t.Fatalf("group=%q want=default", entries[0].Group)
	}
	if entries[0].Status != domain.StatusRealCopyOnly {
		t.Fatalf("status=%s want=%s", entries[0].Status, domain.StatusRealCopyOnly)
	}
}

func TestScanSymlinkOnlyNotNormal(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	tool := filepath.Join(root, "cursor-skills")
	target := filepath.Join(root, "external", "demo")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "SKILL.md"), []byte("---\nname: Demo\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(hub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tool, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := linker.EnsureSymlink(filepath.Join(tool, "demo"), target); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	cfg := config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "skills", Path: hub, Enabled: true, IsHub: true},
			{ID: "cursor", Path: tool, Enabled: true},
		},
	}
	entries, err := Scan(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries=%d", len(entries))
	}
	if entries[0].Status == domain.StatusNormal {
		t.Fatalf("status=normal for symlink-only without hub")
	}
	if entries[0].Status != domain.StatusBrokenLink {
		t.Fatalf("status=%s want=%s", entries[0].Status, domain.StatusBrokenLink)
	}
}

func TestScanCustomGroup(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	skillHub := filepath.Join(hub, "工作流", "s1")
	if err := os.MkdirAll(skillHub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skillHub, "SKILL.md"), []byte("---\nname: S1\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "skills", Path: hub, Enabled: true, IsHub: true},
		},
	}
	entries, err := Scan(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries=%d", len(entries))
	}
	e := entries[0]
	if e.ID != "s1" {
		t.Fatalf("id=%q want=s1", e.ID)
	}
	if e.Group != "工作流" {
		t.Fatalf("group=%q want=工作流", e.Group)
	}
	if e.HubPath != skillHub {
		t.Fatalf("hubPath=%q want=%q", e.HubPath, skillHub)
	}
}

func TestScanToolSymlinkMergesWithHubLeafID(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	tool := filepath.Join(root, "cursor-skills")
	skillHub := filepath.Join(hub, "default", "demo")
	if err := os.MkdirAll(skillHub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skillHub, "SKILL.md"), []byte("---\nname: Demo\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(tool, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := linker.EnsureSymlink(filepath.Join(tool, "demo"), skillHub); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	cfg := config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "skills", Path: hub, Enabled: true, IsHub: true},
			{ID: "cursor", Path: tool, Enabled: true},
		},
	}
	entries, err := Scan(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries=%d want=1 (hub+tool symlink merged by leaf id)", len(entries))
	}
	e := entries[0]
	if e.ID != "demo" {
		t.Fatalf("id=%q want=demo", e.ID)
	}
	if e.Group != "default" {
		t.Fatalf("group=%q want=default", e.Group)
	}
	kinds := map[domain.LocationKind]int{}
	for _, loc := range e.Locations {
		kinds[loc.Kind]++
	}
	if kinds[domain.KindHub] != 1 || kinds[domain.KindSymlink] != 1 {
		t.Fatalf("kinds=%v locs=%+v", kinds, e.Locations)
	}
	if e.Status != domain.StatusNormal {
		t.Fatalf("status=%s want=%s", e.Status, domain.StatusNormal)
	}
}

func TestDeepScanSkipsCacheDirsAndFindsOrphans(t *testing.T) {
	home := t.TempDir()
	orphan := filepath.Join(home, "Projects", "my-skill")
	if err := os.MkdirAll(orphan, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(orphan, "SKILL.md"), []byte("---\nname: My\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 这些目录即使里面有 SKILL.md 也不应被扫到
	for _, name := range []string{".paddlex", "AppData", "Temp", ".cache"} {
		dir := filepath.Join(home, name, "fake-skill")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("---\nname: Fake\n---\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	hub := filepath.Join(home, ".skillsmanager", "skills")
	hubSkill := filepath.Join(hub, "default", "hub-skill")
	if err := os.MkdirAll(hubSkill, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hubSkill, "SKILL.md"), []byte("---\nname: Hub\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	tool := filepath.Join(home, ".cursor", "skills")
	toolSkill := filepath.Join(tool, "tool-skill")
	if err := os.MkdirAll(toolSkill, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(toolSkill, "SKILL.md"), []byte("---\nname: Tool\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	entries, err := DeepScan(home, config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "cursor", Path: tool, Enabled: true},
		},
	}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries=%d want=1 (only orphan under Projects), got=%+v", len(entries), entries)
	}
	if entries[0].ID != "Projects/my-skill" {
		t.Fatalf("id=%q want=Projects/my-skill", entries[0].ID)
	}
	if len(entries[0].Locations) != 1 || entries[0].Locations[0].ToolID != "orphan" {
		t.Fatalf("locations=%+v", entries[0].Locations)
	}
}

func TestScanSkipsNestedSkillInsideSkillDir(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	tool := filepath.Join(root, "tool-skills")
	parent := filepath.Join(tool, "parent")
	nested := filepath.Join(parent, "examples", "child")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(hub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(parent, "SKILL.md"), []byte("---\nname: Parent\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "SKILL.md"), []byte("---\nname: Child\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "skills", Path: hub, Enabled: true, IsHub: true},
			{ID: "cursor", Path: tool, Enabled: true},
		},
	}
	entries, err := Scan(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries=%d want=1 (nested SKILL.md is not a managed skill), got=%+v", len(entries), entries)
	}
	if entries[0].ID != "parent" {
		t.Fatalf("id=%q want=parent", entries[0].ID)
	}
}

func TestDeepScanSkipsNestedSkillInsideSkillDir(t *testing.T) {
	home := t.TempDir()
	parent := filepath.Join(home, "Projects", "parent")
	nested := filepath.Join(parent, "examples", "child")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(parent, "SKILL.md"), []byte("---\nname: Parent\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "SKILL.md"), []byte("---\nname: Child\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	entries, err := DeepScan(home, config.Config{}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries=%d want=1, got=%+v", len(entries), entries)
	}
	if len(entries[0].Locations) != 1 || filepath.Clean(entries[0].Locations[0].Path) != filepath.Clean(parent) {
		t.Fatalf("want parent skill dir, got %+v", entries[0])
	}
}

func TestDeepScanSameLeafOrphansStayDistinct(t *testing.T) {
	home := t.TempDir()
	a := filepath.Join(home, "Projects", "alpha", "demo")
	b := filepath.Join(home, "Other", "demo")
	if err := os.MkdirAll(a, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(b, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(a, "SKILL.md"), []byte("---\nname: A\n---\nalpha\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(b, "SKILL.md"), []byte("---\nname: B\n---\nbeta\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	entries, err := DeepScan(home, config.Config{}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	for _, e := range entries {
		ids[e.ID] = e.Locations[0].Path
	}
	if len(ids) != 2 {
		t.Fatalf("entries=%d ids=%v want 2 distinct relative ids", len(entries), ids)
	}
	if ids["Projects/alpha/demo"] == "" || ids["Other/demo"] == "" {
		t.Fatalf("ids=%v want Projects/alpha/demo and Other/demo", ids)
	}
}
