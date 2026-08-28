package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"SkillsManager/internal/fsutil"
)

func TestDefaultHubPath(t *testing.T) {
	cfg := Default()
	home, _ := os.UserHomeDir()
	want := filepath.Join(home, ".skillsmanager", "skills")
	if cfg.HubPath != want {
		t.Fatalf("hub=%q want=%q", cfg.HubPath, want)
	}
}

func TestDefaultOpenAIModelMatchesPublicEndpoint(t *testing.T) {
	cfg := Default()
	if cfg.OpenAIBaseURL != DefaultOpenAIBaseURL {
		t.Fatalf("base URL=%q want %q", cfg.OpenAIBaseURL, DefaultOpenAIBaseURL)
	}
	if cfg.OpenAIModel != DefaultOpenAIModel {
		t.Fatalf("model=%q want %q", cfg.OpenAIModel, DefaultOpenAIModel)
	}
	if cfg.OpenAIModel != "gpt-5.6-terra" {
		t.Fatalf("default model=%q want gpt-5.6-terra", cfg.OpenAIModel)
	}
}

func TestLoadAppliesTranslationDefaults(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	raw := `{"hubPath":"` + filepath.ToSlash(filepath.Join(dir, "hub")) + `","tools":[],"trashRetentionDays":7}`
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.TranslationEngine != "microsoft_android" {
		t.Fatalf("translation engine=%q", loaded.TranslationEngine)
	}
	if loaded.MicrosoftTranslatorRegion != "eastasia" {
		t.Fatalf("microsoft region=%q", loaded.MicrosoftTranslatorRegion)
	}
	if loaded.TranslationTargetLanguage != "zh-CN" {
		t.Fatalf("translation target language=%q", loaded.TranslationTargetLanguage)
	}
	if loaded.OpenAIBaseURL != DefaultOpenAIBaseURL {
		t.Fatalf("OpenAI base URL=%q", loaded.OpenAIBaseURL)
	}
	if loaded.OpenAIModel != DefaultOpenAIModel {
		t.Fatalf("OpenAI model=%q", loaded.OpenAIModel)
	}
	if loaded.OpenAITemperature != DefaultOpenAITemperature {
		t.Fatalf("OpenAI temperature=%v", loaded.OpenAITemperature)
	}
}

func TestLoadPreservesExplicitOpenAITemperatureZero(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	raw := `{"hubPath":"` + filepath.ToSlash(filepath.Join(dir, "hub")) + `","tools":[],"trashRetentionDays":7,"openAITemperature":0}`
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.OpenAITemperature != 0 {
		t.Fatalf("OpenAI temperature=%v want 0", loaded.OpenAITemperature)
	}
}

func TestNormalizeOpenAITemperature(t *testing.T) {
	if got := NormalizeOpenAITemperature(0); got != 0 {
		t.Fatalf("zero=%v", got)
	}
	if got := NormalizeOpenAITemperature(1); got != 1 {
		t.Fatalf("max=%v", got)
	}
	if got := NormalizeOpenAITemperature(0.5); got != 0.5 {
		t.Fatalf("mid=%v", got)
	}
	if got := NormalizeOpenAITemperature(-1); got != DefaultOpenAITemperature {
		t.Fatalf("neg=%v", got)
	}
	if got := NormalizeOpenAITemperature(1.5); got != DefaultOpenAITemperature {
		t.Fatalf("high=%v", got)
	}
}

func TestDefaultToolsExcludeHub(t *testing.T) {
	cfg := Default()
	for _, tool := range cfg.Tools {
		if tool.IsHub {
			t.Fatalf("default tools must not include hub entry: %+v", tool)
		}
		if fsutil.SamePath(tool.Path, cfg.HubPath) {
			t.Fatalf("default tools must not point at hub: %+v", tool)
		}
	}
}

func TestDefaultToolsIncludeKnownRoots(t *testing.T) {
	cfg := Default()
	home, _ := os.UserHomeDir()
	want := map[string]string{
		"cursor":    filepath.Join(home, ".cursor", "skills"),
		"claude":    filepath.Join(home, ".claude", "skills"),
		"agents":    filepath.Join(home, ".agents", "skills"),
		"opencode":  filepath.Join(home, ".config", "opencode", "skills"),
		"codex":     filepath.Join(home, ".codex", "skills"),
		"deepseek-harness": filepath.Join(home, ".dsh", "skills"),
		"pi":        filepath.Join(home, ".pi", "agent", "skills"),
		"omp":       filepath.Join(home, ".omp", "agent", "skills"),
		"workbuddy": filepath.Join(home, ".workbuddy", "skills"),
		"qoder":     filepath.Join(home, ".qoder", "skills"),
		"qoder-cn":  filepath.Join(home, ".qoder-cn", "skills"),
		"trae":      filepath.Join(home, ".trae", "skills"),
		"trae-cn":   filepath.Join(home, ".trae-cn", "skills"),
	}
	got := map[string]string{}
	for _, tool := range cfg.Tools {
		got[tool.ID] = tool.Path
	}
	for id, path := range want {
		if got[id] != path {
			t.Fatalf("tool %s path=%q want=%q", id, got[id], path)
		}
	}
}

func TestMergeDefaultTools(t *testing.T) {
	cfg := Config{
		HubPath: filepath.Join(t.TempDir(), "hub"),
		Tools: []ToolMapping{
			{ID: "cursor", Path: `D:\custom\cursor`, Enabled: false},
		},
	}
	cfg.MergeDefaultTools()
	byID := map[string]ToolMapping{}
	for _, t := range cfg.Tools {
		byID[t.ID] = t
	}
	if byID["cursor"].Path != `D:\custom\cursor` || byID["cursor"].Enabled {
		t.Fatalf("existing cursor should be preserved: %+v", byID["cursor"])
	}
	if _, ok := byID["agents"]; !ok {
		t.Fatal("expected agents to be merged")
	}
	if _, ok := byID["pi"]; !ok {
		t.Fatal("expected pi to be merged")
	}
	if _, ok := byID["omp"]; !ok {
		t.Fatal("expected omp to be merged")
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	cfg := Default()
	cfg.HubPath = filepath.Join(dir, "hub")
	cfg.TrashRetentionDays = 3
	cfg.LogDebug = true
	if err := cfg.Save(path); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.HubPath != cfg.HubPath || loaded.TrashRetentionDays != 3 {
		t.Fatalf("mismatch: %+v", loaded)
	}
	if !loaded.LogDebug {
		t.Fatal("logDebug should persist")
	}
}

func TestLoadStripsHubTools(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	hub := filepath.Join(dir, "hub")
	raw := Config{
		HubPath:            hub,
		TrashRetentionDays: 7,
		Tools: []ToolMapping{
			{ID: "skills", Path: hub, Enabled: true, IsHub: true},
			{ID: "cursor", Path: filepath.Join(dir, "cursor"), Enabled: true},
			{ID: "dup", Path: hub, Enabled: true},
		},
	}
	b, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]ToolMapping{}
	for _, tool := range loaded.Tools {
		byID[tool.ID] = tool
	}
	if _, ok := byID["skills"]; ok {
		t.Fatalf("hub tool should be stripped: %+v", loaded.Tools)
	}
	if _, ok := byID["dup"]; ok {
		t.Fatalf("hub-path tool should be stripped: %+v", loaded.Tools)
	}
	if got := byID["cursor"]; got.Path != filepath.Join(dir, "cursor") {
		t.Fatalf("cursor path=%q", got.Path)
	}
	if _, ok := byID["agents"]; !ok {
		t.Fatalf("default tools should be merged: %+v", loaded.Tools)
	}
}

func TestEnsureHubDir(t *testing.T) {
	dir := t.TempDir()
	hub := filepath.Join(dir, "nested", "hub")
	if err := EnsureHubDir(hub); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(hub)
	if err != nil || !st.IsDir() {
		t.Fatalf("hub not created: %v", err)
	}
	def := filepath.Join(hub, "default")
	st, err = os.Stat(def)
	if err != nil || !st.IsDir() {
		t.Fatalf("default group dir not created: %v", err)
	}
}

func TestCollapsedSkillGroupsHelpers(t *testing.T) {
	cfg := Config{CollapsedSkillGroups: []string{"a", "b", "c"}}
	cfg.RenameCollapsedSkillGroup("b", "beta")
	if got := strings.Join(cfg.CollapsedSkillGroups, ","); got != "a,c,beta" {
		t.Fatalf("rename got %q", got)
	}
	cfg.RemoveCollapsedSkillGroup("a")
	if got := strings.Join(cfg.CollapsedSkillGroups, ","); got != "c,beta" {
		t.Fatalf("remove got %q", got)
	}
	changed := cfg.PruneCollapsedSkillGroups(map[string]struct{}{"beta": {}})
	if !changed {
		t.Fatal("expected prune to change")
	}
	if got := strings.Join(cfg.CollapsedSkillGroups, ","); got != "beta" {
		t.Fatalf("prune got %q", got)
	}
}

func TestCollapsedSkillGroupsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	cfg := Config{
		HubPath:              filepath.Join(dir, "hub"),
		CollapsedSkillGroups: []string{"ops", "default"},
	}
	if err := cfg.Save(path); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.CollapsedSkillGroups) != 2 || loaded.CollapsedSkillGroups[0] != "ops" {
		t.Fatalf("collapsed=%#v", loaded.CollapsedSkillGroups)
	}
}

func TestLinkSnapshotsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	cfg := Config{
		HubPath: filepath.Join(dir, "hub"),
		Tools: []ToolMapping{
			{ID: "cursor", Path: filepath.Join(dir, "cursor"), Enabled: true},
		},
		LinkSnapshots: map[string]LinkSnapshot{
			"cursor": {
				SkillIDs: []string{"foo", "pkg/bar"},
				SavedAt:  "2026-07-20T10:15:00+08:00",
				Count:    2,
			},
		},
	}
	if err := cfg.Save(path); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	snap, ok := loaded.LinkSnapshots["cursor"]
	if !ok {
		t.Fatal("missing cursor snapshot")
	}
	if snap.Count != 2 || len(snap.SkillIDs) != 2 || snap.SkillIDs[0] != "foo" {
		t.Fatalf("snap=%+v", snap)
	}
}

func TestLoadWithoutLinkSnapshots(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	raw := `{"hubPath":"` + filepath.ToSlash(filepath.Join(dir, "hub")) + `","tools":[],"trashRetentionDays":7}`
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.LinkSnapshots != nil && len(loaded.LinkSnapshots) != 0 {
		t.Fatalf("want empty snapshots, got %#v", loaded.LinkSnapshots)
	}
}
