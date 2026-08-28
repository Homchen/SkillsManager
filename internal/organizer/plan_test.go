package organizer

import (
	"os"
	"path/filepath"
	"testing"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
)

func mustBuildPlan(t *testing.T, entries []domain.SkillEntry, cfg config.Config) domain.OrganizePlan {
	t.Helper()
	plan, err := BuildPlan(entries, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return plan
}

func TestBuildPlanSkipWhenHubAndCorrectSymlink(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub", "demo")
	tool := filepath.Join(root, "tool", "demo")
	if err := os.MkdirAll(hub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hub, "SKILL.md"), []byte("---\nname: demo\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	plan := mustBuildPlan(t, []domain.SkillEntry{{
		ID:      "demo",
		HubPath: hub,
		Status:  domain.StatusNormal,
		Locations: []domain.SkillLocation{
			{ToolID: "skills", Path: hub, Kind: domain.KindHub},
			{ToolID: "cursor", Path: tool, Kind: domain.KindSymlink, LinkTarget: hub},
		},
	}}, config.Config{HubPath: filepath.Join(root, "hub")})

	if len(plan.Actions) != 1 || plan.Actions[0].Type != domain.ActionSkip {
		t.Fatalf("actions=%+v", plan.Actions)
	}
	if !plan.Actions[0].Selected {
		t.Fatal("selected should be true")
	}
	if len(plan.Conflicts) != 0 {
		t.Fatalf("conflicts=%+v", plan.Conflicts)
	}
}

func TestBuildPlanMergeConflictWhenContentDiffers(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub", "demo")
	copyPath := filepath.Join(root, "tool", "demo")
	if err := os.MkdirAll(hub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(copyPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hub, "SKILL.md"), []byte("hub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(copyPath, "SKILL.md"), []byte("copy"), 0o644); err != nil {
		t.Fatal(err)
	}

	plan := mustBuildPlan(t, []domain.SkillEntry{{
		ID:      "demo",
		HubPath: hub,
		Status:  domain.StatusConflict,
		Locations: []domain.SkillLocation{
			{ToolID: "skills", Path: hub, Kind: domain.KindHub},
			{ToolID: "cursor", Path: copyPath, Kind: domain.KindRealCopy},
		},
	}}, config.Config{HubPath: filepath.Join(root, "hub")})

	if len(plan.Actions) != 1 || plan.Actions[0].Type != domain.ActionMergeConflict {
		t.Fatalf("actions=%+v", plan.Actions)
	}
	if len(plan.Conflicts) != 1 {
		t.Fatalf("conflicts=%d", len(plan.Conflicts))
	}
	c := plan.Conflicts[0]
	if c.SideA != hub || c.SideB != copyPath {
		t.Fatalf("sides %q %q", c.SideA, c.SideB)
	}
	if c.SkillID != "demo" {
		t.Fatalf("skillId=%q", c.SkillID)
	}
}

func TestBuildPlanMergeIncludesIdenticalCopiesAndBroken(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub", "demo")
	diffCopy := filepath.Join(root, "tool", "demo")
	sameCopy := filepath.Join(root, "other", "demo")
	broken := filepath.Join(root, "broken", "demo")
	for _, dir := range []string{hub, diffCopy, sameCopy} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(hub, "SKILL.md"), []byte("hub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sameCopy, "SKILL.md"), []byte("hub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(diffCopy, "SKILL.md"), []byte("copy"), 0o644); err != nil {
		t.Fatal(err)
	}

	plan := mustBuildPlan(t, []domain.SkillEntry{{
		ID:      "demo",
		HubPath: hub,
		Status:  domain.StatusConflict,
		Locations: []domain.SkillLocation{
			{ToolID: "skills", Path: hub, Kind: domain.KindHub},
			{ToolID: "cursor", Path: diffCopy, Kind: domain.KindRealCopy},
			{ToolID: "claude", Path: sameCopy, Kind: domain.KindRealCopy},
			{ToolID: "codex", Path: broken, Kind: domain.KindBrokenLink},
		},
	}}, config.Config{HubPath: filepath.Join(root, "hub")})

	if len(plan.Actions) != 1 || plan.Actions[0].Type != domain.ActionMergeConflict {
		t.Fatalf("actions=%+v", plan.Actions)
	}
	got := map[string]bool{}
	for _, p := range plan.Actions[0].Sources {
		got[p] = true
	}
	for _, want := range []string{hub, diffCopy, sameCopy, broken} {
		if !got[want] {
			t.Fatalf("missing source %s in %v", want, plan.Actions[0].Sources)
		}
	}
}

func TestBuildPlanMoveToHubSingleRealCopy(t *testing.T) {
	root := t.TempDir()
	copyPath := filepath.Join(root, "tool", "demo")
	if err := os.MkdirAll(copyPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(copyPath, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	plan := mustBuildPlan(t, []domain.SkillEntry{{
		ID:     "demo",
		Status: domain.StatusRealCopyOnly,
		Locations: []domain.SkillLocation{
			{ToolID: "cursor", Path: copyPath, Kind: domain.KindRealCopy},
		},
	}}, config.Config{HubPath: filepath.Join(root, "hub")})

	if len(plan.Actions) != 1 || plan.Actions[0].Type != domain.ActionMoveToHub {
		t.Fatalf("actions=%+v", plan.Actions)
	}
	if len(plan.Actions[0].Sources) != 1 || plan.Actions[0].Sources[0] != copyPath {
		t.Fatalf("sources=%v", plan.Actions[0].Sources)
	}
}

func TestBuildPlanOrphanNotSelected(t *testing.T) {
	root := t.TempDir()
	copyPath := filepath.Join(root, "orphan", "demo")
	if err := os.MkdirAll(copyPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(copyPath, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	plan := mustBuildPlan(t, []domain.SkillEntry{{
		ID:     "demo",
		Status: domain.StatusRealCopyOnly,
		Locations: []domain.SkillLocation{
			{ToolID: "orphan", Path: copyPath, Kind: domain.KindRealCopy},
		},
	}}, config.Config{HubPath: filepath.Join(root, "hub")})

	if len(plan.Actions) != 1 {
		t.Fatalf("actions=%+v", plan.Actions)
	}
	if plan.Actions[0].Selected {
		t.Fatal("orphan should not be selected by default")
	}
}

func TestBuildPlanErrorsWhenBuildConflictFails(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub", "demo")
	missingCopy := filepath.Join(root, "tool", "missing")
	if err := os.MkdirAll(hub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hub, "SKILL.md"), []byte("hub"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := BuildPlan([]domain.SkillEntry{{
		ID:      "demo",
		HubPath: hub,
		Status:  domain.StatusConflict,
		Locations: []domain.SkillLocation{
			{ToolID: "skills", Path: hub, Kind: domain.KindHub},
			{ToolID: "cursor", Path: missingCopy, Kind: domain.KindRealCopy},
		},
	}}, config.Config{HubPath: filepath.Join(root, "hub")})
	if err == nil {
		t.Fatal("expected BuildPlan error when BuildConflict fails")
	}
}

func TestBuildPlanMoveToHubWhenToolIsExternalSymlink(t *testing.T) {
	root := t.TempDir()
	realDir := filepath.Join(root, "elsewhere", "demo")
	toolLink := filepath.Join(root, "tool", "demo")
	if err := os.MkdirAll(realDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(realDir, "SKILL.md"), []byte("ext"), 0o644); err != nil {
		t.Fatal(err)
	}

	plan := mustBuildPlan(t, []domain.SkillEntry{{
		ID:     "demo",
		Status: domain.StatusBrokenLink,
		Locations: []domain.SkillLocation{
			{ToolID: "cursor", Path: toolLink, Kind: domain.KindSymlink, LinkTarget: realDir},
		},
	}}, config.Config{HubPath: filepath.Join(root, "hub")})

	if len(plan.Actions) != 1 || plan.Actions[0].Type != domain.ActionMoveToHub {
		t.Fatalf("actions=%+v", plan.Actions)
	}
	srcs := plan.Actions[0].Sources
	if len(srcs) != 1 || srcs[0] != toolLink {
		t.Fatalf("sources should be the tool symlink path only, got %v", srcs)
	}
}

func TestBuildPlanFixLinkWhenHubExistsButSymlinkPointsElsewhere(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub", "demo")
	elsewhere := filepath.Join(root, "elsewhere", "demo")
	toolLink := filepath.Join(root, "tool", "demo")
	if err := os.MkdirAll(hub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hub, "SKILL.md"), []byte("hub"), 0o644); err != nil {
		t.Fatal(err)
	}

	plan := mustBuildPlan(t, []domain.SkillEntry{{
		ID:      "demo",
		HubPath: hub,
		Status:  domain.StatusBrokenLink,
		Locations: []domain.SkillLocation{
			{ToolID: "skills", Path: hub, Kind: domain.KindHub},
			{ToolID: "cursor", Path: toolLink, Kind: domain.KindSymlink, LinkTarget: elsewhere},
		},
	}}, config.Config{HubPath: filepath.Join(root, "hub")})

	if len(plan.Actions) != 1 || plan.Actions[0].Type != domain.ActionFixLink {
		t.Fatalf("actions=%+v", plan.Actions)
	}
	if len(plan.Actions[0].Sources) != 1 || plan.Actions[0].Sources[0] != toolLink {
		t.Fatalf("sources=%v", plan.Actions[0].Sources)
	}
}
