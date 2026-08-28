package skilli18n

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTranslationRoot(t *testing.T) {
	hub := filepath.Join(t.TempDir(), "skills")
	s := New(hub)
	got := s.Root()
	want := filepath.Join(filepath.Dir(hub), DirName)
	if got != want {
		t.Fatalf("Root() = %q, want %q", got, want)
	}
}

func TestInitDefaultAndAddTranslation(t *testing.T) {
	hub := t.TempDir()
	s := New(hub)
	id := "demo"

	if err := s.InitDefault(id, "zh-CN"); err != nil {
		t.Fatal(err)
	}
	info, err := s.Info(id)
	if err != nil {
		t.Fatal(err)
	}
	if info.DefaultLanguage != "zh-CN" || info.TranslationCount != 0 {
		t.Fatalf("unexpected info: %+v", info)
	}

	en := s.VersionPath(id, "en")
	if err := os.MkdirAll(en, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(en, "SKILL.md"), []byte("---\nname: demo\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.AddTranslationLanguage(id, "en"); err != nil {
		t.Fatal(err)
	}
	info, err = s.Info(id)
	if err != nil {
		t.Fatal(err)
	}
	if info.TranslationCount != 1 {
		t.Fatalf("TranslationCount = %d, want 1", info.TranslationCount)
	}
}

func TestSetDefaultSwap(t *testing.T) {
	s, id, hubSkill := setupSetDefaultSwap(t)
	if err := s.SetDefault(id, "en", hubSkill); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(hubSkill, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "en" {
		t.Fatalf("hub content = %q, want en", b)
	}
	old := s.VersionPath(id, "zh-CN")
	b, err = os.ReadFile(filepath.Join(old, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "zh" {
		t.Fatalf("old version = %q, want zh", b)
	}
	info, err := s.Info(id)
	if err != nil {
		t.Fatal(err)
	}
	if info.DefaultLanguage != "en" {
		t.Fatalf("default = %q, want en", info.DefaultLanguage)
	}
}

func setupSetDefaultSwap(t *testing.T) (s *Store, id, hubSkill string) {
	t.Helper()
	hubRoot := t.TempDir()
	s = New(hubRoot)
	id = "demo"
	hubSkill = filepath.Join(hubRoot, "default", id)
	if err := os.MkdirAll(hubSkill, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hubSkill, "SKILL.md"), []byte("zh"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.InitDefault(id, "zh-CN"); err != nil {
		t.Fatal(err)
	}
	en := s.VersionPath(id, "en")
	if err := os.MkdirAll(en, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(en, "SKILL.md"), []byte("en"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.AddTranslationLanguage(id, "en"); err != nil {
		t.Fatal(err)
	}
	return s, id, hubSkill
}

func TestSetDefaultRollsBackWhenMetadataSaveFails(t *testing.T) {
	s, id, hubSkill := setupSetDefaultSwap(t)
	// Occupy the atomic-save temp path so Save cannot write metadata.json.
	if err := os.MkdirAll(s.MetaPath(id)+".tmp", 0o755); err != nil {
		t.Fatal(err)
	}
	if err := s.SetDefault(id, "en", hubSkill); err == nil {
		t.Fatal("expected metadata save failure")
	}
	b, err := os.ReadFile(filepath.Join(hubSkill, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "zh" {
		t.Fatalf("hub content = %q, want rolled back to zh", b)
	}
	b, err = os.ReadFile(filepath.Join(s.VersionPath(id, "en"), "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "en" {
		t.Fatalf("en version = %q, want original en", b)
	}
	info, err := s.Info(id)
	if err != nil {
		t.Fatal(err)
	}
	if info.DefaultLanguage != "zh-CN" {
		t.Fatalf("default = %q, want zh-CN after rollback", info.DefaultLanguage)
	}
}

func TestDeleteDefaultRejected(t *testing.T) {
	hub := t.TempDir()
	s := New(hub)
	if err := s.InitDefault("demo", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	err := s.DeleteLanguage("demo", "zh-CN")
	if err == nil {
		t.Fatal("expected error deleting default language")
	}
}

func TestRetagDefaultLanguage(t *testing.T) {
	hub := t.TempDir()
	s := New(hub)
	id := "demo"
	if err := s.InitDefault(id, "en"); err != nil {
		t.Fatal(err)
	}
	if err := s.RetagDefaultLanguage(id, "zh-CN"); err != nil {
		t.Fatal(err)
	}
	info, err := s.Info(id)
	if err != nil {
		t.Fatal(err)
	}
	if info.DefaultLanguage != "zh-CN" {
		t.Fatalf("default = %q, want zh-CN", info.DefaultLanguage)
	}
	if len(info.Languages) != 1 || info.Languages[0] != "zh-CN" {
		t.Fatalf("languages = %v, want [zh-CN]", info.Languages)
	}
}

func TestRetagDefaultLanguageConflict(t *testing.T) {
	hub := t.TempDir()
	s := New(hub)
	id := "demo"
	if err := s.InitDefault(id, "en"); err != nil {
		t.Fatal(err)
	}
	zh := s.VersionPath(id, "zh-CN")
	if err := os.MkdirAll(zh, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(zh, "SKILL.md"), []byte("zh"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.AddTranslationLanguage(id, "zh-CN"); err != nil {
		t.Fatal(err)
	}
	err := s.RetagDefaultLanguage(id, "zh-CN")
	if err == nil {
		t.Fatal("expected conflict when target language already exists")
	}
}

func TestReconcilePrunesMissingDirs(t *testing.T) {
	hub := t.TempDir()
	s := New(hub)
	id := "demo"
	if err := s.InitDefault(id, "zh-CN"); err != nil {
		t.Fatal(err)
	}

	en := s.VersionPath(id, "en")
	if err := os.MkdirAll(en, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(en, "SKILL.md"), []byte("en"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.AddTranslationLanguage(id, "en"); err != nil {
		t.Fatal(err)
	}

	ja := s.VersionPath(id, "ja")
	if err := os.Rename(en, ja); err != nil {
		t.Fatal(err)
	}

	info, err := s.Info(id)
	if err != nil {
		t.Fatal(err)
	}
	if info.DefaultLanguage != "zh-CN" {
		t.Fatalf("default = %q, want zh-CN", info.DefaultLanguage)
	}
	if info.TranslationCount != 1 {
		t.Fatalf("TranslationCount = %d, want 1", info.TranslationCount)
	}
	if containsLang(info.Languages, "en") {
		t.Fatalf("languages still contain en: %v", info.Languages)
	}
	if !containsLang(info.Languages, "ja") {
		t.Fatalf("languages missing ja: %v", info.Languages)
	}
}
