package organizer

import (
	"os"
	"path/filepath"
	"testing"

	"SkillsManager/internal/domain"
	"SkillsManager/internal/trash"
)

func TestCanExecuteBlocksUnresolved(t *testing.T) {
	plan := domain.OrganizePlan{
		Conflicts: []domain.ConflictSkill{{
			SkillID: "a",
			Files: []domain.ConflictFile{{
				RelativePath: "SKILL.md",
				Status:       domain.FileBothDiff,
				IsText:       true,
			}},
		}},
	}
	ok, reason := CanExecute(plan)
	if ok {
		t.Fatal("should block")
	}
	if reason == "" {
		t.Fatal("need reason")
	}
	plan.Conflicts[0].UserSkipped = true
	ok, _ = CanExecute(plan)
	if !ok {
		t.Fatal("skipped should allow")
	}
}

func TestCanExecuteRequiresChoiceAndManualContent(t *testing.T) {
	plan := domain.OrganizePlan{
		Conflicts: []domain.ConflictSkill{{
			SkillID: "a",
			Files: []domain.ConflictFile{
				{RelativePath: "only_a.txt", Status: domain.FileOnlyA, IsText: true},
				{RelativePath: "only_b.txt", Status: domain.FileOnlyB, IsText: true},
				{RelativePath: "same.txt", Status: domain.FileBothSame, IsText: true},
				{RelativePath: "diff.txt", Status: domain.FileBothDiff, IsText: true, Choice: domain.ChoiceKeepA},
			},
		}},
	}
	ok, _ := CanExecute(plan)
	if !ok {
		t.Fatal("defaults and keep_a should allow")
	}

	plan.Conflicts[0].Files[3].Choice = domain.ChoiceManual
	plan.Conflicts[0].Files[3].MergedContent = ""
	ok, reason := CanExecute(plan)
	if ok {
		t.Fatal("manual without content should block")
	}
	if reason == "" {
		t.Fatal("need reason")
	}
	plan.Conflicts[0].Files[3].MergedContent = "merged"
	ok, _ = CanExecute(plan)
	if !ok {
		t.Fatal("manual with content should allow")
	}
}

func TestBuildConflictFileClassification(t *testing.T) {
	root := t.TempDir()
	sideA := filepath.Join(root, "a")
	sideB := filepath.Join(root, "b")
	if err := os.MkdirAll(sideA, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(sideB, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(dir, name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(sideA, "only_a.txt", "a-only")
	write(sideB, "only_b.txt", "b-only")
	write(sideA, "same.txt", "same")
	write(sideB, "same.txt", "same")
	write(sideA, "diff.txt", "left")
	write(sideB, "diff.txt", "right")
	// 与前端 lineDiff 一致：行尾空白 / 末尾换行 / BOM 不应算 both_diff
	write(sideA, "ws.txt", "hello  \n")
	write(sideB, "ws.txt", "hello")
	write(sideA, "bom.txt", "\ufeffsame-body")
	write(sideB, "bom.txt", "same-body")

	c, err := BuildConflict(sideA, sideB)
	if err != nil {
		t.Fatal(err)
	}
	byRel := map[string]domain.ConflictFile{}
	for _, f := range c.Files {
		byRel[f.RelativePath] = f
	}
	assertStatus := func(rel string, want domain.FileConflictStatus) {
		t.Helper()
		f, ok := byRel[rel]
		if !ok {
			t.Fatalf("missing %s", rel)
		}
		if f.Status != want {
			t.Fatalf("%s status=%s want=%s", rel, f.Status, want)
		}
	}
	assertStatus("only_a.txt", domain.FileOnlyA)
	assertStatus("only_b.txt", domain.FileOnlyB)
	assertStatus("same.txt", domain.FileBothSame)
	assertStatus("diff.txt", domain.FileBothDiff)
	assertStatus("ws.txt", domain.FileBothSame)
	assertStatus("bom.txt", domain.FileBothSame)
	if c.SideA != sideA || c.SideB != sideB {
		t.Fatalf("sides: got %q %q", c.SideA, c.SideB)
	}

	texts, err := ReadConflictSideTexts(c, "diff.txt")
	if err != nil {
		t.Fatal(err)
	}
	if texts.SideA != "left" || texts.SideB != "right" {
		t.Fatalf("texts A=%q B=%q", texts.SideA, texts.SideB)
	}
}

func TestCanExecuteBlocksEmptyConflictFiles(t *testing.T) {
	plan := domain.OrganizePlan{
		Conflicts: []domain.ConflictSkill{{
			SkillID: "a",
			Files:   nil,
		}},
	}
	ok, reason := CanExecute(plan)
	if ok {
		t.Fatal("empty Files should block")
	}
	if reason == "" {
		t.Fatal("need reason")
	}
	plan.Conflicts[0].UserSkipped = true
	ok, _ = CanExecute(plan)
	if !ok {
		t.Fatal("skipped empty conflict should allow")
	}
}

func TestCanExecuteRejectsInvalidBothDiffChoice(t *testing.T) {
	plan := domain.OrganizePlan{
		Conflicts: []domain.ConflictSkill{{
			SkillID: "a",
			Files: []domain.ConflictFile{{
				RelativePath: "diff.txt",
				Status:       domain.FileBothDiff,
				IsText:       true,
				Choice:       "keep_both",
			}},
		}},
	}
	ok, reason := CanExecute(plan)
	if ok {
		t.Fatal("invalid choice should block")
	}
	if reason == "" {
		t.Fatal("need reason")
	}
}

func TestCanExecuteRejectsManualForNonText(t *testing.T) {
	plan := domain.OrganizePlan{
		Conflicts: []domain.ConflictSkill{{
			SkillID: "a",
			Files: []domain.ConflictFile{{
				RelativePath:  "blob.bin",
				Status:        domain.FileBothDiff,
				IsText:        false,
				Choice:        domain.ChoiceManual,
				MergedContent: "x",
			}},
		}},
	}
	ok, reason := CanExecute(plan)
	if ok {
		t.Fatal("manual on non-text should block")
	}
	if reason == "" {
		t.Fatal("need Chinese reason")
	}
	plan.Conflicts[0].Files[0].Choice = domain.ChoiceKeepA
	ok, _ = CanExecute(plan)
	if !ok {
		t.Fatal("keep_a on non-text should allow")
	}
}

func TestSkipAndResetConflict(t *testing.T) {
	c := &domain.ConflictSkill{
		SkillID: "x",
		Files: []domain.ConflictFile{{
			RelativePath:  "f.txt",
			Status:        domain.FileBothDiff,
			Choice:        domain.ChoiceManual,
			MergedContent: "m",
			IsText:        true,
		}},
	}
	SkipConflict(c)
	if !c.UserSkipped {
		t.Fatal("expected skipped")
	}
	ResetConflict(c)
	if c.UserSkipped {
		t.Fatal("expected not skipped")
	}
	if c.Files[0].Choice != "" || c.Files[0].MergedContent != "" {
		t.Fatalf("choices not cleared: %+v", c.Files[0])
	}
}

func TestWriteResolvedFileRejectsDotDot(t *testing.T) {
	root := t.TempDir()
	err := writeResolvedFile(domain.ConflictSkill{}, domain.ConflictFile{
		RelativePath:  "../escape.txt",
		Choice:        domain.ChoiceManual,
		MergedContent: "x",
	}, root)
	if err == nil {
		t.Fatal("expected path rejection")
	}
}

func TestApplyConflictRoundCreatesMissingHub(t *testing.T) {
	root := t.TempDir()
	sideA := filepath.Join(root, "a")
	sideB := filepath.Join(root, "b")
	hub := filepath.Join(root, "hub", domain.DefaultGroup, "demo")
	for _, dir := range []string{sideA, sideB} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(sideA, "SKILL.md"), []byte("from-a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sideB, "SKILL.md"), []byte("from-b"), 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := BuildConflict(sideA, sideB)
	if err != nil {
		t.Fatal(err)
	}
	for i := range c.Files {
		c.Files[i].Choice = domain.ChoiceKeepB
	}
	if err := ApplyConflictRound(&c, hub, trash.New(filepath.Join(root, "hub"))); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(hub, "SKILL.md"))
	if err != nil || string(b) != "from-b" {
		t.Fatalf("hub=%q err=%v", b, err)
	}
}

func TestApplyConflictRoundKeepsPendingWhenNextBuildFails(t *testing.T) {
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
	write := func(dir, name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(hub, "SKILL.md", "hub-body")
	write(copy1, "SKILL.md", "copy1-body")
	write(copy2, "SKILL.md", "copy2-body")

	c, err := BuildConflict(hub, copy1)
	if err != nil {
		t.Fatal(err)
	}
	c.SkillID = "demo"
	c.Index = 1
	c.Total = 2
	c.PendingSources = []string{copy2}
	for i := range c.Files {
		if c.Files[i].Status == domain.FileBothDiff {
			c.Files[i].Choice = domain.ChoiceKeepA
		}
	}
	oldSideA, oldSideB := c.SideA, c.SideB
	oldFiles := append([]domain.ConflictFile(nil), c.Files...)

	if err := os.RemoveAll(copy2); err != nil {
		t.Fatal(err)
	}

	err = ApplyConflictRound(&c, hub, trash.New(hubRoot))
	if err == nil {
		t.Fatal("expected next-round build failure")
	}

	if c.Index != 1 {
		t.Fatalf("Index=%d want 1 (must not advance before BuildConflict succeeds)", c.Index)
	}
	if len(c.PendingSources) != 1 || c.PendingSources[0] != copy2 {
		t.Fatalf("PendingSources=%v want [%s]", c.PendingSources, copy2)
	}
	if c.SideA != oldSideA || c.SideB != oldSideB {
		t.Fatalf("sides mutated A=%s B=%s", c.SideA, c.SideB)
	}
	if len(c.Files) != len(oldFiles) {
		t.Fatalf("Files len=%d want %d", len(c.Files), len(oldFiles))
	}

	got, readErr := os.ReadFile(filepath.Join(hub, "SKILL.md"))
	if readErr != nil || string(got) != "hub-body" {
		t.Fatalf("hub should keep round-1 result, got %q err=%v", got, readErr)
	}

	ok, reason := CanExecute(domain.OrganizePlan{Conflicts: []domain.ConflictSkill{c}})
	if ok {
		t.Fatal("CanExecute must block while the next pending source remains")
	}
	if reason == "" {
		t.Fatal("need reason")
	}
}
