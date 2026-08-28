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
