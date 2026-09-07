package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"SkillsManager/internal/config"
)

func isolateAppHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	return home
}

func TestStartupCorruptSettingsLeavesEnv(t *testing.T) {
	home := isolateAppHome(t)
	dir := filepath.Join(home, ".skillsmanager")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	envBody := "OPENAI_API_KEY=sk-keep\nMICROSOFT_TRANSLATOR_KEY=ms-keep\n"
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(envBody), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}

	a := newAppCore()
	a.startup(context.Background())
	t.Cleanup(func() { a.shutdown(context.Background()) })

	got, err := config.LoadOpenAIAPIKey()
	if err != nil {
		t.Fatal(err)
	}
	if got != "sk-keep" {
		t.Fatalf("startup deleted OpenAI key: %q", got)
	}
	if a.cfg.OpenAIAPIKey != "sk-keep" {
		t.Fatalf("memory OpenAI=%q", a.cfg.OpenAIAPIKey)
	}
	if a.cfg.MicrosoftTranslatorKey != "ms-keep" {
		t.Fatalf("memory Microsoft=%q", a.cfg.MicrosoftTranslatorKey)
	}
	if a.configLoadError == "" {
		t.Fatal("want config load error after corrupt JSON")
	}
	if _, err := os.Stat(filepath.Join(dir, "settings.json.corrupt")); err != nil {
		t.Fatalf("corrupt backup: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "sk-keep") || strings.Contains(string(raw), "openAIAPIKey") {
		t.Fatalf("recovered settings.json must not contain secrets: %s", raw)
	}
}

func TestSaveConfigPreservesOnboardingCompleted(t *testing.T) {
	home := isolateAppHome(t)
	a := newAppCore()
	a.cfg = config.Default()
	a.cfg.HubPath = filepath.Join(home, "hub")
	a.cfg.OnboardingCompleted = true
	a.settingsPath = filepath.Join(home, ".skillsmanager", "settings.json")

	incoming := a.cfg
	incoming.OnboardingCompleted = false
	incoming.LogDebug = true
	if err := a.SaveConfig(incoming); err != nil {
		t.Fatal(err)
	}
	if !a.cfg.OnboardingCompleted {
		t.Fatal("SaveConfig must not clear onboardingCompleted")
	}
	if !a.cfg.LogDebug {
		t.Fatal("other settings should persist")
	}
}

func TestCompleteOnboardingPersists(t *testing.T) {
	home := isolateAppHome(t)
	a := newAppCore()
	a.cfg = config.Default()
	a.cfg.HubPath = filepath.Join(home, "hub")
	a.settingsPath = filepath.Join(home, ".skillsmanager", "settings.json")
	if !a.ShouldShowOnboarding() {
		t.Fatal("fresh config should show onboarding")
	}
	if err := a.CompleteOnboarding(); err != nil {
		t.Fatal(err)
	}
	if a.ShouldShowOnboarding() {
		t.Fatal("completed tour should not show again")
	}
	loaded, err := config.Load(a.settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.OnboardingCompleted {
		t.Fatal("onboardingCompleted should be saved")
	}
}

func TestSaveConfigEmptyKeysKeepEnvAndMemory(t *testing.T) {
	home := isolateAppHome(t)
	if err := config.SaveOpenAIAPIKey("sk-keep"); err != nil {
		t.Fatal(err)
	}

	a := newAppCore()
	a.cfg = config.Default()
	a.cfg.HubPath = filepath.Join(home, "hub")
	a.cfg.OpenAIAPIKey = "sk-keep"
	a.settingsPath = filepath.Join(home, ".skillsmanager", "settings.json")

	incoming := a.cfg
	incoming.OpenAIAPIKey = ""
	incoming.LogDebug = true
	if err := a.SaveConfig(incoming); err != nil {
		t.Fatal(err)
	}
	if a.cfg.OpenAIAPIKey != "sk-keep" {
		t.Fatalf("memory=%q", a.cfg.OpenAIAPIKey)
	}
	got, err := config.LoadOpenAIAPIKey()
	if err != nil {
		t.Fatal(err)
	}
	if got != "sk-keep" {
		t.Fatalf("env=%q", got)
	}
	if !a.cfg.LogDebug {
		t.Fatal("other settings should persist")
	}
}

func toolIDs(cfg config.Config) []string {
	ids := make([]string, 0, len(cfg.Tools))
	for _, t := range cfg.Tools {
		ids = append(ids, t.ID)
	}
	return ids
}

func hasToolID(cfg config.Config, id string) bool {
	for _, t := range cfg.Tools {
		if t.ID == id {
			return true
		}
	}
	return false
}

func TestGetConfigDoesNotReadDisk(t *testing.T) {
	home := isolateAppHome(t)
	a := newAppCore()
	a.cfg = config.Default()
	a.cfg.HubPath = filepath.Join(home, "hub")
	a.settingsPath = filepath.Join(home, ".skillsmanager", "settings.json")
	if err := a.persistSettings(); err != nil {
		t.Fatal(err)
	}

	onDisk, err := config.Load(a.settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	onDisk.Tools = append(onDisk.Tools, config.ToolMapping{
		ID:      "merge-wd-alpha",
		Path:    filepath.Join(home, "merge-workdirs", "alpha"),
		Enabled: true,
	})
	if err := onDisk.SaveSettingsJSON(a.settingsPath); err != nil {
		t.Fatal(err)
	}

	got, err := a.GetConfig()
	if err != nil {
		t.Fatal(err)
	}
	if hasToolID(got, "merge-wd-alpha") {
		t.Fatalf("GetConfig must not silently reread disk, tools=%v", toolIDs(got))
	}
}

func TestReloadConfigPicksUpExternalTools(t *testing.T) {
	home := isolateAppHome(t)
	a := newAppCore()
	a.cfg = config.Default()
	a.cfg.HubPath = filepath.Join(home, "hub")
	a.settingsPath = filepath.Join(home, ".skillsmanager", "settings.json")
	if err := a.persistSettings(); err != nil {
		t.Fatal(err)
	}

	onDisk, err := config.Load(a.settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	onDisk.Tools = append(onDisk.Tools, config.ToolMapping{
		ID:      "merge-wd-alpha",
		Path:    filepath.Join(home, "merge-workdirs", "alpha"),
		Enabled: true,
	})
	if err := onDisk.SaveSettingsJSON(a.settingsPath); err != nil {
		t.Fatal(err)
	}

	got, err := a.ReloadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !hasToolID(got, "merge-wd-alpha") {
		t.Fatalf("ReloadConfig tools=%v", toolIDs(got))
	}
	if !hasToolID(a.cfg, "merge-wd-alpha") {
		t.Fatalf("memory after reload tools=%v", toolIDs(a.cfg))
	}
}

func TestReloadConfigCorruptKeepsMemory(t *testing.T) {
	home := isolateAppHome(t)
	a := newAppCore()
	a.cfg = config.Default()
	a.cfg.HubPath = filepath.Join(home, "hub")
	a.cfg.Tools = append(a.cfg.Tools, config.ToolMapping{ID: "keep-me", Path: filepath.Join(home, "keep"), Enabled: true})
	a.settingsPath = filepath.Join(home, ".skillsmanager", "settings.json")
	if err := os.MkdirAll(filepath.Dir(a.settingsPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(a.settingsPath, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := a.ReloadConfig(); err == nil {
		t.Fatal("corrupt settings.json should fail reload")
	}
	if !hasToolID(a.cfg, "keep-me") {
		t.Fatalf("failed reload must keep memory tools=%v", toolIDs(a.cfg))
	}
	if _, err := os.Stat(a.settingsPath + ".corrupt"); err == nil {
		t.Fatal("reload must not rename a corrupt file")
	}
}

func TestPersistSettingsResolvesEmptyPath(t *testing.T) {
	home := isolateAppHome(t)
	if err := config.SaveOpenAIAPIKey("sk-keep"); err != nil {
		t.Fatal(err)
	}

	a := newAppCore()
	a.cfg = config.Default()
	a.cfg.HubPath = filepath.Join(home, "hub")
	a.settingsPath = ""
	if err := a.persistSettings(); err != nil {
		t.Fatal(err)
	}
	if a.settingsPath == "" {
		t.Fatal("settings path should be resolved")
	}
	got, err := config.LoadOpenAIAPIKey()
	if err != nil {
		t.Fatal(err)
	}
	if got != "sk-keep" {
		t.Fatalf("persistSettings deleted OpenAI key: %q", got)
	}
}
