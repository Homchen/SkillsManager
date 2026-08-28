package organizer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/linker"
)

func writeSkillDir(t *testing.T, dir, body string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestNewDeepScanExtrasOmitsAlreadyManaged(t *testing.T) {
	base := []domain.SkillEntry{{ID: "known"}, {ID: "also"}}
	extras := []domain.SkillEntry{
		{ID: "known", Locations: []domain.SkillLocation{{ToolID: "orphan", Path: "/x"}}},
		{ID: "fresh", Locations: []domain.SkillLocation{{ToolID: "orphan", Path: "/y"}}},
	}
	got := newDeepScanExtras(base, extras)
	if len(got) != 1 || got[0].ID != "fresh" {
		t.Fatalf("got=%+v want only fresh", got)
	}
}

func TestMergeSkillEntriesAddsOrphansAndMergesLocations(t *testing.T) {
	base := []domain.SkillEntry{{
		ID: "demo",
		Locations: []domain.SkillLocation{
			{ToolID: "cursor", Path: "/tool/demo", Kind: domain.KindRealCopy},
		},
	}}
	extras := []domain.SkillEntry{
		{
			ID: "demo",
			Locations: []domain.SkillLocation{
				{ToolID: "orphan", Path: "/home/demo", Kind: domain.KindRealCopy},
			},
		},
		{
			ID: "orphan-only",
			Locations: []domain.SkillLocation{
				{ToolID: "orphan", Path: "/home/orphan-only", Kind: domain.KindRealCopy},
			},
		},
	}
	got := mergeSkillEntries(base, extras)
	if len(got) != 2 {
		t.Fatalf("len=%d want=2 got=%+v", len(got), got)
	}
	var demo, orphan *domain.SkillEntry
	for i := range got {
		switch got[i].ID {
		case "demo":
			demo = &got[i]
		case "orphan-only":
			orphan = &got[i]
		}
	}
	if demo == nil || len(demo.Locations) != 2 {
		t.Fatalf("demo locations=%+v", demo)
	}
	if orphan == nil || len(orphan.Locations) != 1 {
		t.Fatalf("orphan=%+v", orphan)
	}
}

func TestDropDeepExtrasRemovesSucceeded(t *testing.T) {
	s := NewSession()
	s.extras = []domain.SkillEntry{
		{ID: "keep"},
		{ID: "gone"},
		{ID: "Projects/nested/old-path"},
	}
	s.dropDeepExtrasLocked([]domain.ReportItem{
		{SkillID: "gone"},
		{SkillID: "old-path"},
	})
	got := map[string]bool{}
	for _, e := range s.extras {
		got[e.ID] = true
	}
	if !got["keep"] || !got["Projects/nested/old-path"] || got["gone"] || len(s.extras) != 2 {
		t.Fatalf("extras=%+v want keep + nested path (exact id match only)", s.extras)
	}
}

func TestValidateOrganizePlanRejectsEscapingPaths(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	tool := filepath.Join(root, "tool")
	outside := filepath.Join(root, "outside", "evil")
	cfg := config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "skills", Path: hub, Enabled: true, IsHub: true},
			{ID: "cursor", Path: tool, Enabled: true},
		},
	}
	plan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{{
			SkillID:  "x",
			Type:     domain.ActionMoveToHub,
			Selected: true,
			Sources:  []string{outside},
		}},
	}
	err := validateOrganizePlan(plan, cfg, nil)
	if err == nil || !strings.Contains(err.Error(), "越界路径") {
		t.Fatalf("expected 越界路径 error, got %v", err)
	}

	orphan := filepath.Join(root, "home", "orphan-skill")
	extras := []domain.SkillEntry{{
		ID: "orphan-skill",
		Locations: []domain.SkillLocation{
			{ToolID: "orphan", Path: orphan, Kind: domain.KindRealCopy},
		},
	}}
	okPlan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{{
			SkillID: "orphan-skill",
			Sources: []string{orphan},
		}},
		Conflicts: []domain.ConflictSkill{{
			SkillID: "orphan-skill",
			SideA:   orphan,
			SideB:   filepath.Join(tool, "orphan-skill"),
		}},
	}
	if err := validateOrganizePlan(okPlan, cfg, extras); err != nil {
		t.Fatalf("orphan + tool paths should be allowed: %v", err)
	}

	evilHub := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{{
			SkillID:  "x",
			Type:     domain.ActionReplaceWithSymlink,
			Selected: true,
			HubPath:  outside,
		}},
	}
	err = validateOrganizePlan(evilHub, cfg, nil)
	if err == nil || !strings.Contains(err.Error(), "越界路径") {
		t.Fatalf("expected 越界路径 for HubPath, got %v", err)
	}

	evilID := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{{
			SkillID:  "../../Windows",
			Type:     domain.ActionMoveToHub,
			Selected: true,
			Sources:  []string{tool},
		}},
	}
	err = validateOrganizePlan(evilID, cfg, nil)
	if err == nil || !strings.Contains(err.Error(), "skill id 非法") {
		t.Fatalf("expected illegal skill id error, got %v", err)
	}
}

func TestSessionPreviewMergesDeepScanFindings(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	writeSkillDir(t, filepath.Join(hub, domain.DefaultGroup, "managed"), "managed")
	orphan := filepath.Join(root, "home", "orphan-skill")
	writeSkillDir(t, orphan, "orphan")

	cfg := config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "skills", Path: hub, Enabled: true, IsHub: true},
		},
	}
	s := NewSession()
	s.extras = []domain.SkillEntry{{
		ID: "orphan-skill",
		Locations: []domain.SkillLocation{
			{ToolID: "orphan", Path: orphan, Kind: domain.KindRealCopy},
		},
	}}

	plan, err := s.Preview(cfg)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, a := range plan.Actions {
		ids[a.SkillID] = true
	}
	if !ids["managed"] || !ids["orphan-skill"] {
		t.Fatalf("actions=%+v want managed + orphan-skill", plan.Actions)
	}
}

func TestSessionRestoreRequiresPreview(t *testing.T) {
	s := NewSession()
	_, err := s.RestoreOrphans([]string{"/tmp/x"}, config.Config{HubPath: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "请先扫描误迁链接") {
		t.Fatalf("got %v", err)
	}
}

func TestSessionCanExecuteRequiresPreview(t *testing.T) {
	s := NewSession()
	_, err := s.CheckExecute()
	if err == nil || !strings.Contains(err.Error(), "请先生成整理预览") {
		t.Fatalf("got %v", err)
	}
}

func TestSessionExecuteDropsSucceededExtrasAndRecordsWorkdirs(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	orphan := filepath.Join(root, "Projects", "nested", "orphan-demo")
	writeSkillDir(t, orphan, "orphan")

	cfg := config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "cursor", Path: filepath.Join(root, ".cursor", "skills"), Enabled: true},
		},
	}
	s := NewSession()
	s.extras = []domain.SkillEntry{
		{
			ID: "Projects/nested/orphan-demo",
			Locations: []domain.SkillLocation{
				{ToolID: "orphan", Path: orphan, Kind: domain.KindRealCopy},
			},
		},
		{ID: "keep"},
	}
	if err := s.Update(domain.OrganizePlan{
		Actions: []domain.OrganizeAction{{
			SkillID:  "Projects/nested/orphan-demo",
			Type:     domain.ActionMoveToHub,
			Selected: true,
			Sources:  []string{orphan},
		}},
	}, cfg); err != nil {
		t.Fatal(err)
	}

	report, err := s.Run(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Succeeded) != 1 {
		t.Fatalf("report=%+v", report)
	}
	got := map[string]bool{}
	for _, e := range s.extras {
		got[e.ID] = true
	}
	if !got["keep"] || got["Projects/nested/orphan-demo"] || len(s.extras) != 1 {
		t.Fatalf("extras=%+v want only keep", s.extras)
	}
	if len(s.SuggestedWorkdirs()) != len(report.SuggestedWorkdirs) {
		t.Fatalf("suggested=%+v report=%+v", s.SuggestedWorkdirs(), report.SuggestedWorkdirs)
	}
}

func TestSessionRestorePrunesCachedItems(t *testing.T) {
	home := t.TempDir()
	hub := filepath.Join(home, ".skillsmanager", "skills")
	misplaced := filepath.Join(hub, "Projects", "nested", "demo")
	writeSkillDir(t, misplaced, "body")
	orphanLink := filepath.Join(home, "Projects", "nested", "demo")
	if err := os.MkdirAll(filepath.Dir(orphanLink), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := linker.EnsureSymlink(orphanLink, misplaced); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}

	cfg := config.Config{HubPath: hub}
	s := NewSession()
	items, err := s.PreviewRestoreOrphans(home, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) == 0 {
		t.Fatal("expected restorable item")
	}
	report, err := s.RestoreOrphans([]string{items[0].LinkPath}, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Succeeded) != 1 {
		t.Fatalf("report=%+v", report)
	}
	if len(s.restoreOrphans) != 0 {
		t.Fatalf("cached orphans=%+v want empty after restore", s.restoreOrphans)
	}
}

func TestNestedSkillMultiRoundMergeWritesOneHubDir(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	var tools []config.ToolMapping
	bodies := []string{"copy-a", "copy-b", "copy-c"}
	for i, body := range bodies {
		toolRoot := filepath.Join(root, "tool"+string(rune('1'+i)))
		child := filepath.Join(toolRoot, "parent", "child")
		writeSkillDir(t, child, body)
		tools = append(tools, config.ToolMapping{
			ID:      "tool" + string(rune('1'+i)),
			Path:    toolRoot,
			Enabled: true,
		})
	}
	cfg := config.Config{HubPath: hub, Tools: tools}

	s := NewSession()
	plan, err := s.Preview(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Conflicts) != 1 || plan.Conflicts[0].SkillID != "parent/child" {
		t.Fatalf("conflicts=%+v want one parent/child", plan.Conflicts)
	}
	c := plan.Conflicts[0]
	if c.Total != 2 || len(c.PendingSources) != 1 {
		t.Fatalf("round meta total=%d pending=%v want Total=2", c.Total, c.PendingSources)
	}
	resolveKeepA := func(p *domain.OrganizePlan) {
		t.Helper()
		for i := range p.Conflicts[0].Files {
			if p.Conflicts[0].Files[i].Status == domain.FileBothDiff {
				p.Conflicts[0].Files[i].Choice = domain.ChoiceKeepA
			}
		}
	}
	resolveKeepA(&plan)
	if err := s.Update(plan, cfg); err != nil {
		t.Fatal(err)
	}

	plan, err = s.ApplyRound("parent/child", cfg)
	if err != nil {
		t.Fatal(err)
	}
	resolveKeepA(&plan)
	if err := s.Update(plan, cfg); err != nil {
		t.Fatal(err)
	}

	report, err := s.Run(cfg)
	if err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if len(report.Failed) != 0 {
		t.Fatalf("report=%+v", report)
	}

	want := filepath.Join(hub, domain.DefaultGroup, "child")
	if !fileExists(t, filepath.Join(want, "SKILL.md")) {
		t.Fatalf("missing canonical hub skill %s", want)
	}
	split := filepath.Join(hub, "parent", "child")
	if fileExists(t, filepath.Join(split, "SKILL.md")) {
		t.Fatalf("nested id wrote a second hub path %s", split)
	}
	if fileExists(t, filepath.Join(hub, domain.DefaultGroup, "parent", "child", "SKILL.md")) {
		t.Fatal("must not land nested id under default/<parts>")
	}
}

func fileExists(t *testing.T, path string) bool {
	t.Helper()
	_, err := os.Stat(path)
	return err == nil
}
