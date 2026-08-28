package skillusage

import (
	"path/filepath"
	"testing"

	"SkillsManager/internal/domain"
)

func TestSummarizeMatchesKeyAndTranslationPaths(t *testing.T) {
	hub := t.TempDir()
	translationRoot := filepath.Join(filepath.Dir(hub), "skills_translation")

	entries := []domain.SkillEntry{
		{ID: "alpha", Name: "Alpha", HubPath: filepath.Join(hub, "default", "alpha")},
		{ID: "beta", Name: "Beta", HubPath: filepath.Join(hub, "default", "beta")},
	}

	data := fileData{
		Version: 2,
		Skills: map[string]fileRecord{
			"alpha": {
				Count:      3,
				LastUsedAt: "2026-07-28T10:00:00Z",
				Paths:      []string{filepath.Join(hub, "default", "alpha", "SKILL.md")},
				Daily:      map[string]int{"2026-07-27": 1, "2026-07-28": 2},
			},
			"zh-CN": {
				Count:      4,
				LastUsedAt: "2026-07-28T12:00:00Z",
				Paths: []string{
					filepath.Join(translationRoot, "beta", "zh-CN", "SKILL.md"),
				},
				Daily: map[string]int{"2026-07-28": 4},
			},
			"orphan": {
				Count: 9,
				Paths: []string{filepath.Join(t.TempDir(), "orphan", "SKILL.md")},
				Daily: map[string]int{"2026-07-28": 9},
			},
		},
	}

	summary := Summarize(data, entries, translationRoot)
	if !summary.HasAnyRecord {
		t.Fatal("expected HasAnyRecord")
	}
	if len(summary.Skills) != 2 {
		t.Fatalf("expected 2 managed skills, got %d", len(summary.Skills))
	}

	byID := map[string]domain.SkillUsageItem{}
	for _, s := range summary.Skills {
		byID[s.ID] = s
	}

	alpha := byID["alpha"]
	if alpha.Count != 3 || alpha.Daily["2026-07-28"] != 2 {
		t.Fatalf("alpha stats unexpected: %+v", alpha)
	}

	beta := byID["beta"]
	if beta.Count != 4 || beta.Daily["2026-07-28"] != 4 {
		t.Fatalf("beta should absorb zh-CN translation reads, got %+v", beta)
	}
	if beta.LastUsedAt != "2026-07-28T12:00:00Z" {
		t.Fatalf("beta lastUsedAt: %s", beta.LastUsedAt)
	}
}

func TestSummarizeEmptyFileIncludesZeros(t *testing.T) {
	entries := []domain.SkillEntry{{ID: "only", Name: "Only"}}
	summary := Summarize(fileData{Skills: map[string]fileRecord{}}, entries, "")
	if summary.HasAnyRecord {
		t.Fatal("expected no records")
	}
	if len(summary.Skills) != 1 || summary.Skills[0].Count != 0 {
		t.Fatalf("unexpected summary: %+v", summary)
	}
}

func TestResolveSkillKeyViaTranslationLayout(t *testing.T) {
	root := t.TempDir()
	translationRoot := filepath.Join(root, "skills_translation")
	path := filepath.Join(translationRoot, "demo", "en", "SKILL.md")
	id, ok := translationSkillID(path, translationRoot)
	if !ok || id != "demo" {
		t.Fatalf("got %q ok=%v", id, ok)
	}
}
