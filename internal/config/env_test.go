package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUpsertAndLoadOpenAIAPIKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")

	if err := upsertEnvValue(path, openAIAPIKeyEnvName, "sk-test"); err != nil {
		t.Fatal(err)
	}
	got, err := loadEnvValue(path, openAIAPIKeyEnvName)
	if err != nil {
		t.Fatal(err)
	}
	if got != "sk-test" {
		t.Fatalf("got=%q", got)
	}

	if err := upsertEnvValue(path, openAIAPIKeyEnvName, "sk-next"); err != nil {
		t.Fatal(err)
	}
	got, err = loadEnvValue(path, openAIAPIKeyEnvName)
	if err != nil {
		t.Fatal(err)
	}
	if got != "sk-next" {
		t.Fatalf("got=%q after update", got)
	}

	if err := upsertEnvValue(path, openAIAPIKeyEnvName, ""); err != nil {
		t.Fatal(err)
	}
	got, err = loadEnvValue(path, openAIAPIKeyEnvName)
	if err != nil {
		t.Fatal(err)
	}
	if got != "" {
		t.Fatalf("want empty after delete, got=%q", got)
	}
}

func TestSaveDoesNotPersistOpenAIAPIKeyInJSON(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)

	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	cfg := Default()
	cfg.HubPath = filepath.Join(dir, "hub")
	cfg.OpenAIAPIKey = "sk-secret"
	if err := cfg.Save(path); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "sk-secret") || strings.Contains(string(raw), "openAIAPIKey") {
		t.Fatalf("settings.json must not contain API key: %s", raw)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.OpenAIAPIKey != "sk-secret" {
		t.Fatalf("loaded key=%q", loaded.OpenAIAPIKey)
	}
}

func isolateHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	return home
}

func TestSaveEmptySecretsDoNotDeleteEnv(t *testing.T) {
	home := isolateHome(t)
	if err := SaveOpenAIAPIKey("sk-keep"); err != nil {
		t.Fatal(err)
	}
	if err := SaveMicrosoftTranslatorKey("ms-keep"); err != nil {
		t.Fatal(err)
	}

	cfg := Default()
	cfg.HubPath = filepath.Join(home, "hub")
	cfg.OpenAIAPIKey = ""
	cfg.MicrosoftTranslatorKey = "  "
	path := filepath.Join(home, "settings.json")
	if err := cfg.Save(path); err != nil {
		t.Fatal(err)
	}

	gotOpenAI, err := LoadOpenAIAPIKey()
	if err != nil {
		t.Fatal(err)
	}
	if gotOpenAI != "sk-keep" {
		t.Fatalf("empty OpenAIAPIKey Save deleted .env key: got %q", gotOpenAI)
	}
	gotMS, err := LoadMicrosoftTranslatorKey()
	if err != nil {
		t.Fatal(err)
	}
	if gotMS != "ms-keep" {
		t.Fatalf("empty MicrosoftTranslatorKey Save deleted .env key: got %q", gotMS)
	}
}

func TestSaveJSONFailureLeavesEnvUnchanged(t *testing.T) {
	home := isolateHome(t)
	if err := SaveOpenAIAPIKey("sk-old"); err != nil {
		t.Fatal(err)
	}

	parent := filepath.Join(home, "not-a-dir")
	if err := os.WriteFile(parent, []byte("file"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := Default()
	cfg.HubPath = filepath.Join(home, "hub")
	cfg.OpenAIAPIKey = "sk-new"
	if err := cfg.Save(filepath.Join(parent, "settings.json")); err == nil {
		t.Fatal("expected Save to fail when settings path cannot be created")
	}

	got, err := LoadOpenAIAPIKey()
	if err != nil {
		t.Fatal(err)
	}
	if got != "sk-old" {
		t.Fatalf("JSON write failure must not update .env: got %q", got)
	}
}

func TestLoadMigratesLegacyJSONOpenAIAPIKey(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)

	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	hub := filepath.ToSlash(filepath.Join(dir, "hub"))
	raw := `{"hubPath":"` + hub + `","tools":[],"trashRetentionDays":7,"openAIAPIKey":"sk-legacy"}`
	if err := os.WriteFile(path, []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}

	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.OpenAIAPIKey != "sk-legacy" {
		t.Fatalf("loaded=%q", loaded.OpenAIAPIKey)
	}
	envKey, err := LoadOpenAIAPIKey()
	if err != nil {
		t.Fatal(err)
	}
	if envKey != "sk-legacy" {
		t.Fatalf("env key=%q", envKey)
	}
	rawAfter, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(rawAfter), "sk-legacy") || strings.Contains(string(rawAfter), "openAIAPIKey") {
		t.Fatalf("settings.json must strip migrated key: %s", rawAfter)
	}
}

func TestSaveClearSecretRemovesEnv(t *testing.T) {
	home := isolateHome(t)
	if err := SaveOpenAIAPIKey("sk-keep"); err != nil {
		t.Fatal(err)
	}
	if err := SaveMicrosoftTranslatorKey("ms-keep"); err != nil {
		t.Fatal(err)
	}

	cfg := Default()
	cfg.HubPath = filepath.Join(home, "hub")
	cfg.OpenAIAPIKey = ClearSecret
	path := filepath.Join(home, "settings.json")
	if err := cfg.Save(path); err != nil {
		t.Fatal(err)
	}

	gotOpenAI, err := LoadOpenAIAPIKey()
	if err != nil {
		t.Fatal(err)
	}
	if gotOpenAI != "" {
		t.Fatalf("ClearSecret should delete OpenAI key, got %q", gotOpenAI)
	}
	gotMS, err := LoadMicrosoftTranslatorKey()
	if err != nil {
		t.Fatal(err)
	}
	if gotMS != "ms-keep" {
		t.Fatalf("ClearSecret on OpenAI must not delete Microsoft key, got %q", gotMS)
	}

	cfg.OpenAIAPIKey = ClearSecret
	if err := cfg.HydrateSecrets(); err != nil {
		t.Fatal(err)
	}
	gotOpenAI, err = LoadOpenAIAPIKey()
	if err != nil {
		t.Fatal(err)
	}
	if gotOpenAI != "" {
		t.Fatalf("HydrateSecrets resurrected OpenAI key: %q", gotOpenAI)
	}
	if cfg.OpenAIAPIKey != "" {
		t.Fatalf("memory after hydrate=%q", cfg.OpenAIAPIKey)
	}
}

func TestRecoverCorruptSettingsLeavesEnvAndHydrates(t *testing.T) {
	home := isolateHome(t)
	if err := SaveOpenAIAPIKey("sk-keep"); err != nil {
		t.Fatal(err)
	}
	if err := SaveMicrosoftTranslatorKey("ms-keep"); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(home, ".skillsmanager", "settings.json")
	cfg, err := RecoverCorruptSettings(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.OpenAIAPIKey != "sk-keep" {
		t.Fatalf("recovered memory OpenAI=%q", cfg.OpenAIAPIKey)
	}
	if cfg.MicrosoftTranslatorKey != "ms-keep" {
		t.Fatalf("recovered memory Microsoft=%q", cfg.MicrosoftTranslatorKey)
	}

	gotOpenAI, err := LoadOpenAIAPIKey()
	if err != nil {
		t.Fatal(err)
	}
	if gotOpenAI != "sk-keep" {
		t.Fatalf("RecoverCorruptSettings deleted OpenAI key: got %q", gotOpenAI)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "sk-keep") || strings.Contains(string(raw), "openAIAPIKey") {
		t.Fatalf("recovered settings.json must not contain secrets: %s", raw)
	}
}
