package organizer

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
	"SkillsManager/internal/linker"
	"SkillsManager/internal/trash"
)

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

func TestExecuteRejectedWhenUnresolved(t *testing.T) {
	root := t.TempDir()
	marker := filepath.Join(root, "marker.txt")
	if err := os.WriteFile(marker, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := Execute(domain.OrganizePlan{
		Conflicts: []domain.ConflictSkill{{
			SkillID: "x",
			Files:   []domain.ConflictFile{{Status: domain.FileBothDiff, RelativePath: "SKILL.md", IsText: true}},
		}},
		Actions: []domain.OrganizeAction{{
			SkillID:  "x",
			Type:     domain.ActionMergeConflict,
			Selected: true,
			Sources:  []string{marker},
		}},
	}, config.Default(), nil)
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "未决议") && !strings.Contains(err.Error(), "冲突") {
		t.Fatalf("expected Chinese conflict error, got %v", err)
	}
	if _, statErr := os.Stat(marker); statErr != nil {
		t.Fatal("must not mutate when rejected")
	}
}

func TestApplyConflictToHubReplacesExistingHubInPlace(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub", "demo")
	sideB := filepath.Join(root, "b")
	if err := os.MkdirAll(hub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(sideB, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hub, "SKILL.md"), []byte("old-hub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hub, "stale.txt"), []byte("gone"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideB, "SKILL.md"), []byte("from-b"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideB, "extra.md"), []byte("e"), 0o644); err != nil {
		t.Fatal(err)
	}

	// 直接验证就地替换：不 rename 目录本身，也能清掉旧文件并写入新树
	tmp := filepath.Join(root, "hub", ".merge-tmp-test")
	if err := os.MkdirAll(tmp, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "SKILL.md"), []byte("from-b"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "extra.md"), []byte("e"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := replaceDirContents(hub, tmp); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(hub, "SKILL.md"))
	if err != nil || string(b) != "from-b" {
		t.Fatalf("SKILL.md=%q err=%v", b, err)
	}
	if _, err := os.Stat(filepath.Join(hub, "extra.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(hub, "stale.txt")); !os.IsNotExist(err) {
		t.Fatal("stale.txt should be removed by in-place replace")
	}
	if _, err := os.Stat(tmp); !os.IsNotExist(err) {
		t.Fatal("tmp should be removed")
	}

	// SideA == hub：完整 ApplyConflictToHub 覆盖已有源仓
	if err := os.WriteFile(filepath.Join(hub, "SKILL.md"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	conflict := domain.ConflictSkill{
		SkillID: "demo",
		SideA:   hub,
		SideB:   sideB,
		Files: []domain.ConflictFile{
			{RelativePath: "SKILL.md", Status: domain.FileBothDiff, Choice: domain.ChoiceKeepB, IsText: true},
			{RelativePath: "extra.md", Status: domain.FileOnlyB, IsText: true},
		},
	}
	if err := ApplyConflictToHub(conflict, hub); err != nil {
		t.Fatal(err)
	}
	b, err = os.ReadFile(filepath.Join(hub, "SKILL.md"))
	if err != nil || string(b) != "from-b" {
		t.Fatalf("after ApplyConflictToHub SKILL.md=%q err=%v", b, err)
	}
}

func TestApplyConflictToHubWritesResultTree(t *testing.T) {
	root := t.TempDir()
	sideA := filepath.Join(root, "a")
	sideB := filepath.Join(root, "b")
	hub := filepath.Join(root, "hub", "demo")
	if err := os.MkdirAll(filepath.Join(sideA, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(sideB, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideA, "only_a.txt"), []byte("A"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideB, "only_b.txt"), []byte("B"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideA, "same.txt"), []byte("same"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideB, "same.txt"), []byte("same"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideA, "diff.txt"), []byte("fromA"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideB, "diff.txt"), []byte("fromB"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideA, "manual.txt"), []byte("ma"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideB, "manual.txt"), []byte("mb"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideA, "sub", "nested.txt"), []byte("nest"), 0o644); err != nil {
		t.Fatal(err)
	}

	conflict := domain.ConflictSkill{
		SkillID: "demo",
		SideA:   sideA,
		SideB:   sideB,
		Files: []domain.ConflictFile{
			{RelativePath: "only_a.txt", Status: domain.FileOnlyA, IsText: true},
			{RelativePath: "only_b.txt", Status: domain.FileOnlyB, IsText: true},
			{RelativePath: "same.txt", Status: domain.FileBothSame, IsText: true},
			{RelativePath: "diff.txt", Status: domain.FileBothDiff, Choice: domain.ChoiceKeepB, IsText: true},
			{RelativePath: "manual.txt", Status: domain.FileBothDiff, Choice: domain.ChoiceManual, MergedContent: "merged!", IsText: true},
			{RelativePath: "sub/nested.txt", Status: domain.FileOnlyA, IsText: true},
		},
	}
	if err := ApplyConflictToHub(conflict, hub); err != nil {
		t.Fatal(err)
	}

	assertFile := func(rel, want string) {
		t.Helper()
		b, err := os.ReadFile(filepath.Join(hub, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatalf("%s: %v", rel, err)
		}
		if string(b) != want {
			t.Fatalf("%s=%q want %q", rel, b, want)
		}
	}
	assertFile("only_a.txt", "A")
	assertFile("only_b.txt", "B")
	assertFile("same.txt", "same")
	assertFile("diff.txt", "fromB")
	assertFile("manual.txt", "merged!")
	assertFile("sub/nested.txt", "nest")
}

func TestExecuteMoveToHubAndReplace(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	toolRoot := filepath.Join(root, "tool")
	copyPath := filepath.Join(toolRoot, "demo")
	if err := os.MkdirAll(copyPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(copyPath, "SKILL.md"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{
		HubPath: hubRoot,
		Tools:   []config.ToolMapping{{ID: "cursor", Path: toolRoot, Enabled: true}},
	}
	plan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{{
			SkillID:  "demo",
			Type:     domain.ActionMoveToHub,
			Selected: true,
			Sources:  []string{copyPath},
		}},
	}
	report, err := Execute(plan, cfg, trash.New(hubRoot))
	if err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if len(report.Succeeded) != 1 || len(report.Failed) != 0 {
		t.Fatalf("report=%+v", report)
	}
	hubSkill := filepath.Join(hubRoot, domain.DefaultGroup, "demo")
	b, err := os.ReadFile(filepath.Join(hubSkill, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "hello" {
		t.Fatalf("hub content=%q", b)
	}
	fi, err := os.Lstat(copyPath)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("tool path should be symlink after move")
	}
	if len(report.SuggestedWorkdirs) != 0 {
		t.Fatalf("tool-root real copy should not suggest workdir, got=%+v", report.SuggestedWorkdirs)
	}

	// Second skill: hub exists + identical real copy → replace_with_symlink
	otherHub := filepath.Join(hubRoot, domain.DefaultGroup, "other")
	otherCopy := filepath.Join(toolRoot, "other")
	if err := os.MkdirAll(otherHub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(otherCopy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(otherHub, "SKILL.md"), []byte("same"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(otherCopy, "SKILL.md"), []byte("same"), 0o644); err != nil {
		t.Fatal(err)
	}
	plan2 := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{
			{SkillID: "skipme", Type: domain.ActionSkip, Selected: true},
			{SkillID: "other", Type: domain.ActionReplaceWithSymlink, Selected: true, Sources: []string{otherCopy}},
			{SkillID: "noselect", Type: domain.ActionMoveToHub, Selected: false, Sources: []string{filepath.Join(toolRoot, "x")}},
		},
	}
	report2, err := Execute(plan2, cfg, trash.New(hubRoot))
	if err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if len(report2.Succeeded) != 1 || len(report2.Skipped) != 2 {
		t.Fatalf("report2=%+v", report2)
	}
	fi, err = os.Lstat(otherCopy)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("replaced path should be symlink")
	}
	rel, _ := filepath.Rel(hubRoot, filepath.Join(hubRoot, "_trash"))
	_ = rel
	entries, err := os.ReadDir(filepath.Join(hubRoot, "_trash"))
	if err != nil || len(entries) == 0 {
		t.Fatalf("expected trashed real copy, err=%v entries=%v", err, entries)
	}
}

func TestExecuteMoveToHubCutsExternalSymlinkTarget(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	realDir := filepath.Join(root, "elsewhere", "demo")
	toolLink := filepath.Join(root, "tool", "demo")
	if err := os.MkdirAll(realDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(toolLink), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(realDir, "SKILL.md"), []byte("cut-me"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := linker.EnsureSymlink(toolLink, realDir); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}

	cfg := config.Config{
		HubPath: hubRoot,
		Tools:   []config.ToolMapping{{ID: "cursor", Path: filepath.Dir(toolLink), Enabled: true}},
	}
	plan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{{
			SkillID:  "demo",
			Type:     domain.ActionMoveToHub,
			Selected: true,
			Sources:  []string{toolLink},
		}},
	}
	report, err := Execute(plan, cfg, trash.New(hubRoot))
	if err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if len(report.Succeeded) != 1 || len(report.Failed) != 0 {
		t.Fatalf("report=%+v", report)
	}

	hubSkill := filepath.Join(hubRoot, domain.DefaultGroup, "demo")
	b, err := os.ReadFile(filepath.Join(hubSkill, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "cut-me" {
		t.Fatalf("hub content=%q", b)
	}
	if _, err := os.Lstat(realDir); !os.IsNotExist(err) {
		t.Fatalf("external target should be cut away, err=%v", err)
	}
	fi, err := os.Lstat(toolLink)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("tool path should remain a symlink")
	}
	got, err := os.Readlink(toolLink)
	if err != nil {
		t.Fatal(err)
	}
	gotAbs, _ := filepath.Abs(got)
	hubAbs, _ := filepath.Abs(hubSkill)
	if !strings.EqualFold(filepath.Clean(gotAbs), filepath.Clean(hubAbs)) {
		t.Fatalf("tool link target=%q want hub %q", gotAbs, hubAbs)
	}
	if len(report.SuggestedWorkdirs) != 1 {
		t.Fatalf("suggested=%+v", report.SuggestedWorkdirs)
	}
	parent := filepath.Dir(realDir)
	if !fsutil.SamePath(report.SuggestedWorkdirs[0].Path, parent) {
		t.Fatalf("suggested path=%q want %q", report.SuggestedWorkdirs[0].Path, parent)
	}
	if report.SuggestedWorkdirs[0].SkillCount != 1 || report.SuggestedWorkdirs[0].SkillIDs[0] != "demo" {
		t.Fatalf("suggested=%+v", report.SuggestedWorkdirs[0])
	}
}

func TestExecuteMoveToHubCutsExternalSymlinkTargetSkipsConfiguredTool(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	realDir := filepath.Join(root, "elsewhere", "demo")
	toolLink := filepath.Join(root, "tool", "demo")
	if err := os.MkdirAll(realDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(toolLink), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(realDir, "SKILL.md"), []byte("cut-me"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := linker.EnsureSymlink(toolLink, realDir); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}

	parent := filepath.Dir(realDir)
	cfg := config.Config{
		HubPath: hubRoot,
		Tools: []config.ToolMapping{
			{ID: "elsewhere", Path: parent, Enabled: true},
			{ID: "cursor", Path: filepath.Dir(toolLink), Enabled: true},
		},
	}
	plan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{{
			SkillID:  "demo",
			Type:     domain.ActionMoveToHub,
			Selected: true,
			Sources:  []string{toolLink},
		}},
	}
	report, err := Execute(plan, cfg, trash.New(hubRoot))
	if err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if len(report.Succeeded) != 1 || len(report.Failed) != 0 {
		t.Fatalf("report=%+v", report)
	}
	if len(report.SuggestedWorkdirs) != 0 {
		t.Fatalf("suggested should be empty when Tools contains parent, got=%+v", report.SuggestedWorkdirs)
	}
}

func TestExecuteNestedSkillMoveAfterParent(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	toolRoot := filepath.Join(root, "tool")
	parent := filepath.Join(toolRoot, "huashu-nuwa")
	nested := filepath.Join(parent, "examples", "andrej-karpathy-perspective")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(parent, "SKILL.md"), []byte("parent"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "SKILL.md"), []byte("nested"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{HubPath: hubRoot}
	plan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{
			{
				SkillID:  "huashu-nuwa",
				Type:     domain.ActionMoveToHub,
				Selected: true,
				Sources:  []string{parent},
			},
			{
				SkillID:  "huashu-nuwa/examples/andrej-karpathy-perspective",
				Type:     domain.ActionMoveToHub,
				Selected: true,
				// 计划生成时的嵌套路径；父级迁入后该路径会消失，hub 子路径已存在
				Sources: []string{nested},
			},
		},
	}
	report, err := Execute(plan, cfg, trash.New(hubRoot))
	if err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if len(report.Failed) != 0 {
		t.Fatalf("nested move should not fail as 目标已存在: %+v", report.Failed)
	}
	if len(report.Succeeded) != 2 {
		t.Fatalf("want 2 succeeded, got %+v", report)
	}
	hubNested := filepath.Join(hubRoot, domain.DefaultGroup, "huashu-nuwa", "examples", "andrej-karpathy-perspective", "SKILL.md")
	b, err := os.ReadFile(hubNested)
	if err != nil || string(b) != "nested" {
		t.Fatalf("hub nested content=%q err=%v", b, err)
	}
	if _, err := os.Stat(filepath.Join(hubRoot, domain.DefaultGroup, "huashu-nuwa", "SKILL.md")); err != nil {
		t.Fatalf("parent should land under default: %v", err)
	}
}

func TestExecuteMergeConflictAppliesAndLinks(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	sideA := filepath.Join(hubRoot, domain.DefaultGroup, "demo")
	sideB := filepath.Join(root, "tool", "demo")
	if err := os.MkdirAll(sideA, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(sideB, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideA, "SKILL.md"), []byte("hub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideB, "SKILL.md"), []byte("tool"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideB, "extra.md"), []byte("e"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{
		HubPath: hubRoot,
		Tools: []config.ToolMapping{
			{ID: "cursor", Path: filepath.Join(root, "tool"), Enabled: true},
		},
	}
	plan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{{
			SkillID:  "demo",
			Type:     domain.ActionMergeConflict,
			Selected: true,
			Sources:  []string{sideA, sideB},
		}},
		Conflicts: []domain.ConflictSkill{{
			SkillID: "demo",
			SideA:   sideA,
			SideB:   sideB,
			Files: []domain.ConflictFile{
				{RelativePath: "SKILL.md", Status: domain.FileBothDiff, Choice: domain.ChoiceKeepB, IsText: true},
				{RelativePath: "extra.md", Status: domain.FileOnlyB, IsText: true},
			},
		}},
	}
	report, err := Execute(plan, cfg, nil)
	if err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if len(report.Succeeded) != 1 {
		t.Fatalf("report=%+v", report)
	}
	b, err := os.ReadFile(filepath.Join(sideA, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "tool" {
		t.Fatalf("merged hub SKILL.md=%q", b)
	}
	if _, err := os.Stat(filepath.Join(sideA, "extra.md")); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Lstat(sideB)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("sideB should become symlink")
	}
}

func TestSequentialMergeThreeDifferingCopiesNoDataLoss(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	hub := filepath.Join(hubRoot, domain.DefaultGroup, "demo")
	copy1 := filepath.Join(root, "tool1", "demo")
	copy2 := filepath.Join(root, "tool2", "demo")
	for _, dir := range []string{hub, copy1, copy2} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(hub, "SKILL.md"), []byte("hub-body"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hub, "only_hub.txt"), []byte("H"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(copy1, "SKILL.md"), []byte("copy1-body"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(copy1, "only_c1.txt"), []byte("C1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(copy2, "SKILL.md"), []byte("copy2-body"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(copy2, "only_c2.txt"), []byte("C2"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{
		HubPath: hubRoot,
		Tools: []config.ToolMapping{
			{ID: "tool1", Path: filepath.Join(root, "tool1"), Enabled: true},
			{ID: "tool2", Path: filepath.Join(root, "tool2"), Enabled: true},
		},
	}
	plan, err := BuildPlan([]domain.SkillEntry{{
		ID:      "demo",
		HubPath: hub,
		Status:  domain.StatusConflict,
		Locations: []domain.SkillLocation{
			{ToolID: "skills", Path: hub, Kind: domain.KindHub},
			{ToolID: "tool1", Path: copy1, Kind: domain.KindRealCopy},
			{ToolID: "tool2", Path: copy2, Kind: domain.KindRealCopy},
		},
	}}, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Conflicts) != 1 {
		t.Fatalf("conflicts=%+v", plan.Conflicts)
	}
	c := &plan.Conflicts[0]
	if c.Index != 1 || c.Total != 2 || len(c.PendingSources) != 1 {
		t.Fatalf("round1 meta index=%d total=%d pending=%v", c.Index, c.Total, c.PendingSources)
	}
	if !fsutil.SamePath(c.SideA, hub) || !fsutil.SamePath(c.SideB, copy1) {
		t.Fatalf("round1 sides A=%s B=%s", c.SideA, c.SideB)
	}
	if ok, _ := CanExecute(plan); ok {
		t.Fatal("must block execute while pending rounds remain")
	}

	// Round 1: keep hub SKILL.md, take only_c1 from B (default only_b).
	for i := range c.Files {
		if c.Files[i].Status == domain.FileBothDiff {
			c.Files[i].Choice = domain.ChoiceKeepA
		}
	}
	tr := trash.New(hubRoot)
	if err := ApplyConflictRound(c, hub, tr); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(copy1); !os.IsNotExist(err) {
		t.Fatal("copy1 should be trashed only after it was merged")
	}
	if _, err := os.Stat(filepath.Join(hub, "only_c1.txt")); err != nil {
		t.Fatal("only_c1.txt must survive into hub after round 1")
	}
	if _, err := os.Stat(copy2); err != nil {
		t.Fatal("unmerged copy2 must still exist as a real directory")
	}
	fi, err := os.Lstat(copy2)
	if err != nil || fi.Mode()&os.ModeSymlink != 0 || !fi.IsDir() {
		t.Fatalf("copy2 must remain a real dir, fi=%v err=%v", fi, err)
	}
	if c.Index != 2 || c.Total != 2 || len(c.PendingSources) != 0 {
		t.Fatalf("round2 meta index=%d total=%d pending=%v", c.Index, c.Total, c.PendingSources)
	}
	if !fsutil.SamePath(c.SideB, copy2) {
		t.Fatalf("round2 SideB=%s want %s", c.SideB, copy2)
	}

	// Round 2: keep hub SKILL.md, take only_c2 from B.
	for i := range c.Files {
		if c.Files[i].Status == domain.FileBothDiff {
			c.Files[i].Choice = domain.ChoiceKeepA
		}
	}
	plan.Conflicts[0] = *c
	report, err := Execute(plan, cfg, tr)
	if err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if len(report.Succeeded) != 1 || len(report.Failed) != 0 {
		t.Fatalf("report=%+v", report)
	}

	assertFile := func(rel, want string) {
		t.Helper()
		b, err := os.ReadFile(filepath.Join(hub, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatalf("%s: %v", rel, err)
		}
		if string(b) != want {
			t.Fatalf("%s=%q want %q", rel, b, want)
		}
	}
	assertFile("SKILL.md", "hub-body")
	assertFile("only_hub.txt", "H")
	assertFile("only_c1.txt", "C1")
	assertFile("only_c2.txt", "C2")

	for _, p := range []string{copy1, copy2} {
		fi, err := os.Lstat(p)
		if err != nil {
			t.Fatalf("link %s: %v", p, err)
		}
		if fi.Mode()&os.ModeSymlink == 0 {
			t.Fatalf("%s should be symlink after sequential merge", p)
		}
	}
}

func TestExecuteContinuesAfterPerItemFailure(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	good := filepath.Join(root, "tool", "good")
	if err := os.MkdirAll(good, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(good, "SKILL.md"), []byte("g"), 0o644); err != nil {
		t.Fatal(err)
	}

	plan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{
			{
				SkillID:  "bad",
				Type:     domain.ActionMoveToHub,
				Selected: true,
				Sources:  []string{filepath.Join(root, "missing-skill")},
			},
			{
				SkillID:  "good",
				Type:     domain.ActionMoveToHub,
				Selected: true,
				Sources:  []string{good},
			},
		},
	}
	report, err := Execute(plan, config.Config{HubPath: hubRoot}, nil)
	if err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if len(report.Failed) != 1 || report.Failed[0].SkillID != "bad" {
		t.Fatalf("failed=%+v", report.Failed)
	}
	if len(report.Succeeded) != 1 || report.Succeeded[0].SkillID != "good" {
		t.Fatalf("succeeded=%+v", report.Succeeded)
	}
}

// Regression: skill already under a custom group must be the replace/fix target,
// not hub/default/<id>.
func TestReplaceTargetsCustomGroupHubNotDefault(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	customHub := filepath.Join(hubRoot, "自定义", "demo")
	toolRoot := filepath.Join(root, "tool")
	realCopy := filepath.Join(toolRoot, "demo")

	if err := os.MkdirAll(customHub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(realCopy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(customHub, "SKILL.md"), []byte("hub-v"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(realCopy, "SKILL.md"), []byte("hub-v"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{HubPath: hubRoot}
	// No HubPath on action — must resolve via scan of custom group.
	plan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{{
			SkillID:  "demo",
			Type:     domain.ActionReplaceWithSymlink,
			Selected: true,
			Sources:  []string{realCopy},
		}},
	}
	report, err := Execute(plan, cfg, trash.New(hubRoot))
	if err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if len(report.Failed) != 0 {
		t.Fatalf("failed=%+v", report.Failed)
	}
	if len(report.Succeeded) != 1 {
		t.Fatalf("succeeded=%+v", report.Succeeded)
	}

	defaultPath := filepath.Join(hubRoot, domain.DefaultGroup, "demo")
	if _, err := os.Stat(defaultPath); !os.IsNotExist(err) {
		t.Fatalf("must not create/use default/demo, err=%v", err)
	}
	if !fsutil.IsSkillDir(customHub) {
		t.Fatal("custom hub skill must remain")
	}
	fi, err := os.Lstat(realCopy)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("tool copy should become symlink")
	}
	target, err := os.Readlink(realCopy)
	if err != nil {
		t.Fatal(err)
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		absTarget = filepath.Clean(target)
	}
	absCustom, _ := filepath.Abs(customHub)
	if !strings.EqualFold(filepath.Clean(absTarget), filepath.Clean(absCustom)) {
		t.Fatalf("symlink target=%q want=%q", absTarget, absCustom)
	}
}

func TestFixLinkTargetsCustomGroupViaHubPath(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	customHub := filepath.Join(hubRoot, "自定义", "demo")
	toolRoot := filepath.Join(root, "tool")
	broken := filepath.Join(toolRoot, "demo")

	if err := os.MkdirAll(customHub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(toolRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(customHub, "SKILL.md"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := linker.EnsureSymlink(broken, filepath.Join(hubRoot, "default", "demo")); err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}

	plan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{{
			SkillID:  "demo",
			Type:     domain.ActionFixLink,
			Selected: true,
			Sources:  []string{broken},
			HubPath:  customHub,
		}},
	}
	report, err := Execute(plan, config.Config{HubPath: hubRoot}, trash.New(hubRoot))
	if err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if len(report.Failed) != 0 {
		t.Fatalf("failed=%+v", report.Failed)
	}
	target, err := os.Readlink(broken)
	if err != nil {
		t.Fatal(err)
	}
	absTarget, _ := filepath.Abs(target)
	absCustom, _ := filepath.Abs(customHub)
	if !strings.EqualFold(filepath.Clean(absTarget), filepath.Clean(absCustom)) {
		t.Fatalf("fixed target=%q want=%q", absTarget, absCustom)
	}
	if _, err := os.Stat(filepath.Join(hubRoot, domain.DefaultGroup, "demo")); !os.IsNotExist(err) {
		t.Fatal("must not create default/demo")
	}
}

func TestExecuteMoveOrphanUsesLeafIDAndDoesNotRelink(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	orphan := filepath.Join(root, "Projects", "nested", "orphan-demo")
	if err := os.MkdirAll(orphan, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(orphan, "SKILL.md"), []byte("orphan"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{
		HubPath: hubRoot,
		Tools: []config.ToolMapping{
			{ID: "cursor", Path: filepath.Join(root, ".cursor", "skills"), Enabled: true},
		},
	}
	// 模拟旧深度扫描用相对路径当 id 的情况
	plan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{{
			SkillID:  "Projects/nested/orphan-demo",
			Type:     domain.ActionMoveToHub,
			Selected: true,
			Sources:  []string{orphan},
		}},
	}
	report, err := Execute(plan, cfg, trash.New(hubRoot))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Succeeded) != 1 || len(report.Failed) != 0 {
		t.Fatalf("report=%+v", report)
	}
	hubSkill := filepath.Join(hubRoot, domain.DefaultGroup, "orphan-demo")
	b, err := os.ReadFile(filepath.Join(hubSkill, "SKILL.md"))
	if err != nil {
		t.Fatalf("hub skill missing at %s: %v", hubSkill, err)
	}
	if string(b) != "orphan" {
		t.Fatalf("content=%q", b)
	}
	if _, err := os.Lstat(orphan); !os.IsNotExist(err) {
		t.Fatal("orphan source should be cut without leaving a symlink")
	}
	if _, err := os.Stat(filepath.Join(hubRoot, "Projects")); !os.IsNotExist(err) {
		t.Fatal("must not create hub/Projects/... path for orphan import")
	}
	parent := filepath.Dir(orphan)
	if len(report.SuggestedWorkdirs) != 1 {
		t.Fatalf("orphan real copy should suggest parent workdir, got=%+v", report.SuggestedWorkdirs)
	}
	if !fsutil.SamePath(report.SuggestedWorkdirs[0].Path, parent) {
		t.Fatalf("suggested path=%q want %q", report.SuggestedWorkdirs[0].Path, parent)
	}
	if report.SuggestedWorkdirs[0].SkillCount != 1 || report.SuggestedWorkdirs[0].SkillIDs[0] != "orphan-demo" {
		t.Fatalf("suggested=%+v", report.SuggestedWorkdirs[0])
	}
}

func TestExecuteMergeConflictDoesNotLinkOrphanSources(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	sideA := filepath.Join(hubRoot, domain.DefaultGroup, "demo")
	sideB := filepath.Join(root, "Projects", "nested", "demo")
	if err := os.MkdirAll(sideA, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(sideB, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideA, "SKILL.md"), []byte("hub"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideB, "SKILL.md"), []byte("orphan"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideB, "extra.md"), []byte("e"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{
		HubPath: hubRoot,
		Tools: []config.ToolMapping{
			{ID: "cursor", Path: filepath.Join(root, ".cursor", "skills"), Enabled: true},
		},
	}
	plan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{{
			SkillID:  "demo",
			Type:     domain.ActionMergeConflict,
			Selected: true,
			Sources:  []string{sideA, sideB},
		}},
		Conflicts: []domain.ConflictSkill{{
			SkillID: "demo",
			SideA:   sideA,
			SideB:   sideB,
			Files: []domain.ConflictFile{
				{RelativePath: "SKILL.md", Status: domain.FileBothDiff, Choice: domain.ChoiceKeepB, IsText: true},
				{RelativePath: "extra.md", Status: domain.FileOnlyB, IsText: true},
			},
		}},
	}
	report, err := Execute(plan, cfg, nil)
	if err != nil {
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if len(report.Succeeded) != 1 || len(report.Failed) != 0 {
		t.Fatalf("report=%+v", report)
	}
	b, err := os.ReadFile(filepath.Join(sideA, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "orphan" {
		t.Fatalf("merged hub SKILL.md=%q", b)
	}
	if _, err := os.Stat(filepath.Join(sideA, "extra.md")); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Lstat(sideB)
	if err == nil {
		if fi.Mode()&os.ModeSymlink != 0 {
			t.Fatal("orphan path must not become a hub symlink")
		}
		t.Fatal("orphan real copy should be cut without leaving a leftover path")
	}
	if !os.IsNotExist(err) {
		t.Fatalf("orphan path: %v", err)
	}
}

func TestExecuteIdenticalSameLeafOrphansTrashesLeftover(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	a := filepath.Join(root, "Projects", "alpha", "demo")
	b := filepath.Join(root, "Other", "demo")
	body := []byte("---\nname: Demo\n---\nsame\n")
	for _, dir := range []string{a, b} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	plan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{
			{SkillID: "Projects/alpha/demo", Type: domain.ActionMoveToHub, Selected: true, Sources: []string{a}},
			{SkillID: "Other/demo", Type: domain.ActionMoveToHub, Selected: true, Sources: []string{b}},
		},
	}
	report, err := Execute(plan, config.Config{HubPath: hubRoot}, trash.New(hubRoot))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Failed) != 0 {
		t.Fatalf("failed=%+v", report.Failed)
	}
	if len(report.Succeeded) != 2 {
		t.Fatalf("succeeded=%+v", report.Succeeded)
	}
	hubSkill := filepath.Join(hubRoot, domain.DefaultGroup, "demo")
	got, err := os.ReadFile(filepath.Join(hubSkill, "SKILL.md"))
	if err != nil || string(got) != string(body) {
		t.Fatalf("hub=%q err=%v", got, err)
	}
	for _, p := range []string{a, b} {
		if _, err := os.Lstat(p); !os.IsNotExist(err) {
			t.Fatalf("identical leftover must be cut, still exists: %s", p)
		}
	}
}

func TestExecuteDifferentSameLeafOrphansDoesNotMerge(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	a := filepath.Join(root, "Projects", "alpha", "demo")
	b := filepath.Join(root, "Other", "demo")
	if err := os.MkdirAll(a, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(b, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(a, "SKILL.md"), []byte("alpha"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(b, "SKILL.md"), []byte("beta"), 0o644); err != nil {
		t.Fatal(err)
	}
	plan := domain.OrganizePlan{
		Actions: []domain.OrganizeAction{
			{SkillID: "Projects/alpha/demo", Type: domain.ActionMoveToHub, Selected: true, Sources: []string{a}},
			{SkillID: "Other/demo", Type: domain.ActionMoveToHub, Selected: true, Sources: []string{b}},
		},
	}
	report, err := Execute(plan, config.Config{HubPath: hubRoot}, trash.New(hubRoot))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Succeeded) != 1 || len(report.Failed) != 1 {
		t.Fatalf("report=%+v want 1 succeeded + 1 failed (do not merge different same-leaf orphans)", report)
	}
	hubBody, err := os.ReadFile(filepath.Join(hubRoot, domain.DefaultGroup, "demo", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(hubBody) != "alpha" {
		t.Fatalf("hub must keep first copy, got %q", hubBody)
	}
	if _, err := os.Lstat(b); err != nil {
		t.Fatal("conflicting second copy must remain on disk")
	}
}

func TestNestedSkillIDHubPathsAgree(t *testing.T) {
	hub := t.TempDir()
	wantDefault := filepath.Join(hub, domain.DefaultGroup, "child")

	gotConflict, err := conflictHubPath(hub, "parent/child")
	if err != nil {
		t.Fatal(err)
	}
	gotExec, err := hubSkillPath(hub, "parent/child")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Clean(gotConflict) != filepath.Clean(wantDefault) {
		t.Fatalf("conflictHubPath=%q want %q", gotConflict, wantDefault)
	}
	if filepath.Clean(gotExec) != filepath.Clean(wantDefault) {
		t.Fatalf("hubSkillPath=%q want %q", gotExec, wantDefault)
	}

	gotExisting := existingHubSkillPath(hub, domain.OrganizeAction{SkillID: "parent/child"}, gotExec)
	if filepath.Clean(gotExisting) != filepath.Clean(wantDefault) {
		t.Fatalf("existingHubSkillPath fallback=%q want %q", gotExisting, wantDefault)
	}

	custom := filepath.Join(hub, "team", "child")
	if err := os.MkdirAll(custom, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(custom, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	gotConflict, err = conflictHubPath(hub, "parent/child")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Clean(gotConflict) != filepath.Clean(custom) {
		t.Fatalf("conflictHubPath existing group=%q want %q", gotConflict, custom)
	}
	gotExisting = existingHubSkillPath(hub, domain.OrganizeAction{SkillID: "parent/child"}, gotExec)
	if filepath.Clean(gotExisting) != filepath.Clean(custom) {
		t.Fatalf("existingHubSkillPath existing group=%q want %q", gotExisting, custom)
	}
}

func TestSourceNeedsToolRelink(t *testing.T) {
	root := t.TempDir()
	tool := filepath.Join(root, "cursor-skills")
	cfg := config.Config{
		Tools: []config.ToolMapping{{ID: "cursor", Path: tool, Enabled: true}},
	}
	if !sourceNeedsToolRelink(filepath.Join(tool, "demo"), cfg) {
		t.Fatal("tool path should need relink")
	}
	if sourceNeedsToolRelink(filepath.Join(root, "Projects", "demo"), cfg) {
		t.Fatal("orphan path should not need relink")
	}
}
