package workdir

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
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

func TestConfirmAddWritesToolAndLinks(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	hub := filepath.Join(hubRoot, "default", "demo")
	parent := filepath.Join(root, "ext")
	_ = os.MkdirAll(hub, 0o755)
	_ = os.MkdirAll(parent, 0o755)
	_ = os.WriteFile(filepath.Join(hub, "SKILL.md"), []byte("x"), 0o644)

	cfg := config.Config{HubPath: hubRoot, Tools: nil}
	sugs := []domain.SuggestedWorkdir{{
		Path: parent, SkillIDs: []string{"demo"}, SkillCount: 1,
	}}
	res, err := ConfirmAdd(&cfg, sugs, []string{parent}, cfg.HubPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Tools) != 1 || !cfg.Tools[0].Enabled {
		t.Fatalf("tools=%+v", cfg.Tools)
	}
	if len(res.Added) != 1 {
		t.Fatalf("added=%+v", res.Added)
	}
	link := filepath.Join(parent, "demo")
	fi, err := os.Lstat(link)
	if err != nil {
		// Windows 无权限建链时 Skip
		skipIfSymlinkPermission(t, err)
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("expected symlink")
	}
}

func TestConfirmAddEmptyPathsNoOp(t *testing.T) {
	cfg := config.Config{HubPath: "hub", Tools: nil}
	res, err := ConfirmAdd(&cfg, []domain.SuggestedWorkdir{{
		Path: "somewhere", SkillIDs: []string{"demo"}, SkillCount: 1,
	}}, nil, cfg.HubPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Tools) != 0 {
		t.Fatalf("tools should be unchanged, got=%+v", cfg.Tools)
	}
	if len(res.Added)+len(res.Linked)+len(res.Skipped)+len(res.Failed) != 0 {
		t.Fatalf("want empty result, got=%+v", res)
	}
}

func TestConfirmAddUnknownPathSkipped(t *testing.T) {
	root := t.TempDir()
	parent := filepath.Join(root, "ext")
	_ = os.MkdirAll(parent, 0o755)

	cfg := config.Config{HubPath: filepath.Join(root, "hub"), Tools: nil}
	unknown := filepath.Join(root, "other")
	_ = os.MkdirAll(unknown, 0o755)
	res, err := ConfirmAdd(&cfg, []domain.SuggestedWorkdir{{
		Path: parent, SkillIDs: []string{"demo"}, SkillCount: 1,
	}}, []string{unknown}, cfg.HubPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Tools) != 0 {
		t.Fatalf("tools=%+v", cfg.Tools)
	}
	if len(res.Added) != 0 || len(res.Skipped) != 1 {
		t.Fatalf("want 1 skipped, got=%+v", res)
	}
	if !strings.Contains(res.Skipped[0].Message, "不在建议列表中") {
		t.Fatalf("skipped message=%q", res.Skipped[0].Message)
	}
}

func TestConfirmAddRealDirTargetSkipped(t *testing.T) {
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	hub := filepath.Join(hubRoot, "default", "demo")
	parent := filepath.Join(root, "ext")
	realTarget := filepath.Join(parent, "demo")
	_ = os.MkdirAll(hub, 0o755)
	_ = os.MkdirAll(realTarget, 0o755)
	_ = os.WriteFile(filepath.Join(hub, "SKILL.md"), []byte("x"), 0o644)
	_ = os.WriteFile(filepath.Join(realTarget, "SKILL.md"), []byte("y"), 0o644)

	cfg := config.Config{HubPath: hubRoot, Tools: nil}
	sugs := []domain.SuggestedWorkdir{{
		Path: parent, SkillIDs: []string{"demo"}, SkillCount: 1,
	}}
	res, err := ConfirmAdd(&cfg, sugs, []string{parent}, cfg.HubPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Tools) != 1 {
		t.Fatalf("tools=%+v", cfg.Tools)
	}
	if len(res.Added) != 1 {
		t.Fatalf("added=%+v", res.Added)
	}
	if len(res.Linked) != 0 {
		t.Fatalf("linked=%+v", res.Linked)
	}
	if len(res.Skipped) != 1 {
		t.Fatalf("skipped=%+v", res.Skipped)
	}
	fi, err := os.Lstat(realTarget)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		t.Fatal("real dir must not become symlink")
	}
}
