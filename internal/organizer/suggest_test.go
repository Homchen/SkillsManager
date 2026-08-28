package organizer

import (
	"os"
	"path/filepath"
	"testing"

	"SkillsManager/internal/config"
	"SkillsManager/internal/fsutil"
)

func TestFilterSuggestedWorkdirsMergesAndSkipsConfigured(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub")
	ext := filepath.Join(root, "ext-skills")
	configured := filepath.Join(root, "already")
	_ = os.MkdirAll(hub, 0o755)
	_ = os.MkdirAll(ext, 0o755)
	_ = os.MkdirAll(configured, 0o755)

	cfg := config.Config{
		HubPath: hub,
		Tools: []config.ToolMapping{
			{ID: "x", Path: configured, Enabled: true},
		},
	}
	cuts := []cutRecord{
		{ParentDir: ext, SkillID: "a"},
		{ParentDir: ext, SkillID: "b"},
		{ParentDir: configured, SkillID: "c"},
		{ParentDir: hub, SkillID: "d"},
	}
	got := FilterSuggestedWorkdirs(cuts, cfg)
	if len(got) != 1 {
		t.Fatalf("got=%+v", got)
	}
	if got[0].Path != filepath.Clean(ext) && !fsutil.SamePath(got[0].Path, ext) {
		t.Fatalf("path=%q", got[0].Path)
	}
	if got[0].SkillCount != 2 || len(got[0].SkillIDs) != 2 {
		t.Fatalf("skills=%+v", got[0])
	}
}
