package skilli18n

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestInfoWithoutDefaultLanguageLanguagesNotNil(t *testing.T) {
	s := New(t.TempDir())
	info, err := s.Info("imported-without-lang")
	if err != nil {
		t.Fatal(err)
	}
	if info.DefaultLanguage != "" {
		t.Fatalf("default = %q, want empty", info.DefaultLanguage)
	}
	if info.Languages == nil {
		t.Fatal("Languages is nil; JSON encodes as null and the editor crashes")
	}
	b, err := json.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(b, []byte(`"languages":[]`)) {
		t.Fatalf("JSON = %s, want languages to be an empty array", b)
	}
}

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

func TestRenameNoopWhenSourceMissing(t *testing.T) {
	s := New(t.TempDir())
	if err := s.CanRename("missing", "next"); err != nil {
		t.Fatal(err)
	}
	if err := s.Rename("missing", "next"); err != nil {
		t.Fatal(err)
	}
}

func TestRenameConflictWhenDestExists(t *testing.T) {
	hub := t.TempDir()
	s := New(hub)
	if err := s.InitDefault("old", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	if err := s.InitDefault("taken", "en"); err != nil {
		t.Fatal(err)
	}
	if err := s.CanRename("old", "taken"); err == nil {
		t.Fatal("expected dest conflict")
	}
	if err := s.Rename("old", "taken"); err == nil {
		t.Fatal("expected dest conflict")
	}
	if _, err := os.Stat(s.SkillDir("old")); err != nil {
		t.Fatalf("source should remain: %v", err)
	}
}

func TestMigrateRootMovesWhenDestMissing(t *testing.T) {
	root := t.TempDir()
	oldHub := filepath.Join(root, "old", "skills")
	newHub := filepath.Join(root, "new", "skills")
	s := New(oldHub)
	if err := s.InitDefault("demo", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	if err := CheckMigrateRoot(oldHub, newHub); err != nil {
		t.Fatal(err)
	}
	if err := MigrateRoot(oldHub, newHub); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.Root()); !os.IsNotExist(err) {
		t.Fatal("old translation root should be gone")
	}
	moved := New(newHub)
	if _, err := os.Stat(moved.MetaPath("demo")); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateRootEmptyDestIsReplaced(t *testing.T) {
	root := t.TempDir()
	oldHub := filepath.Join(root, "old", "skills")
	newHub := filepath.Join(root, "new", "skills")
	s := New(oldHub)
	if err := s.InitDefault("demo", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	empty := New(newHub).Root()
	if err := os.MkdirAll(empty, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := MigrateRoot(oldHub, newHub); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(New(newHub).MetaPath("demo")); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateRootNonEmptyDestErrors(t *testing.T) {
	root := t.TempDir()
	oldHub := filepath.Join(root, "old", "skills")
	newHub := filepath.Join(root, "new", "skills")
	if err := New(oldHub).InitDefault("demo", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	dest := New(newHub)
	if err := dest.InitDefault("other", "en"); err != nil {
		t.Fatal(err)
	}
	if err := CheckMigrateRoot(oldHub, newHub); err == nil {
		t.Fatal("expected non-empty dest error")
	}
	if err := MigrateRoot(oldHub, newHub); err == nil {
		t.Fatal("expected non-empty dest error")
	}
	if _, err := os.Stat(New(oldHub).MetaPath("demo")); err != nil {
		t.Fatalf("old translation repo should stay: %v", err)
	}
	if _, err := os.Stat(dest.MetaPath("other")); err != nil {
		t.Fatalf("dest translation repo should stay: %v", err)
	}
}

func TestMigrateRootNoopWhenOldMissing(t *testing.T) {
	root := t.TempDir()
	oldHub := filepath.Join(root, "old", "skills")
	newHub := filepath.Join(root, "new", "skills")
	if err := CheckMigrateRoot(oldHub, newHub); err != nil {
		t.Fatal(err)
	}
	if err := MigrateRoot(oldHub, newHub); err != nil {
		t.Fatal(err)
	}
}
