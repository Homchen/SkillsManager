package bulklink

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/linker"
)

func canSymlink(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	target := filepath.Join(dir, "t")
	link := filepath.Join(dir, "l")
	if err := os.Mkdir(target, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		if runtime.GOOS == "windows" {
			t.Skip("symlink requires elevation on this Windows host")
		}
		t.Fatal(err)
	}
}

func TestDisableEmptyToolIDs(t *testing.T) {
	cfg := config.Config{}
	_, err := Disable(&cfg, nil, nil)
	if err == nil || err.Error() == "" {
		t.Fatal("expected error")
	}
}

func TestDisableRemovesSymlinkKeepsRealCopyAndWritesSnapshot(t *testing.T) {
	canSymlink(t)
	root := t.TempDir()
	hub := filepath.Join(root, "hub", "foo")
	toolRoot := filepath.Join(root, "cursor")
	if err := os.MkdirAll(hub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hub, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(toolRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(toolRoot, "foo")
	if err := linker.EnsureSymlink(linkPath, hub); err != nil {
		t.Fatal(err)
	}
	realPath := filepath.Join(toolRoot, "bar")
	if err := os.MkdirAll(realPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(realPath, "SKILL.md"), []byte("y"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{
		HubPath: filepath.Join(root, "hub"),
		Tools: []config.ToolMapping{
			{ID: "cursor", Path: toolRoot, Enabled: true},
		},
		LinkSnapshots: map[string]config.LinkSnapshot{
			"cursor": {SkillIDs: []string{"old"}, SavedAt: "old", Count: 1},
		},
	}
	entries := []domain.SkillEntry{
		{
			ID: "foo",
			Locations: []domain.SkillLocation{
				{ToolID: "cursor", Path: linkPath, Kind: domain.KindSymlink},
			},
		},
		{
			ID: "bar",
			Locations: []domain.SkillLocation{
				{ToolID: "cursor", Path: realPath, Kind: domain.KindRealCopy},
			},
		},
	}
	res, err := Disable(&cfg, entries, []string{"cursor"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Totals.Removed != 1 {
		t.Fatalf("removed=%d", res.Totals.Removed)
	}
	if _, err := os.Lstat(linkPath); !os.IsNotExist(err) {
		t.Fatalf("symlink should be gone: %v", err)
	}
	if _, err := os.Stat(realPath); err != nil {
		t.Fatalf("real_copy must remain: %v", err)
	}
	snap := cfg.LinkSnapshots["cursor"]
	if snap.Count != 1 || len(snap.SkillIDs) != 1 || snap.SkillIDs[0] != "foo" {
		t.Fatalf("snapshot=%+v", snap)
	}
	if snap.SavedAt == "old" || snap.SavedAt == "" {
		t.Fatalf("savedAt not updated: %q", snap.SavedAt)
	}
}

func TestDisableZeroLinksPreservesSnapshot(t *testing.T) {
	cfg := config.Config{
		Tools: []config.ToolMapping{{ID: "cursor", Path: t.TempDir(), Enabled: true}},
		LinkSnapshots: map[string]config.LinkSnapshot{
			"cursor": {SkillIDs: []string{"keep"}, SavedAt: "2026-01-01T00:00:00Z", Count: 1},
		},
	}
	res, err := Disable(&cfg, nil, []string{"cursor"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Totals.Removed != 0 {
		t.Fatalf("removed=%d", res.Totals.Removed)
	}
	if cfg.LinkSnapshots["cursor"].SkillIDs[0] != "keep" {
		t.Fatalf("snapshot overwritten: %+v", cfg.LinkSnapshots["cursor"])
	}
}

func TestEnableRestoreAndAll(t *testing.T) {
	canSymlink(t)
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	fooHub := filepath.Join(hubRoot, "default", "foo")
	barHub := filepath.Join(hubRoot, "team", "bar")
	toolRoot := filepath.Join(root, "cursor")
	for _, d := range []string{fooHub, barHub, toolRoot} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	_ = os.WriteFile(filepath.Join(fooHub, "SKILL.md"), []byte("a"), 0o644)
	_ = os.WriteFile(filepath.Join(barHub, "SKILL.md"), []byte("b"), 0o644)

	cfg := config.Config{
		HubPath: hubRoot,
		Tools:   []config.ToolMapping{{ID: "cursor", Path: toolRoot, Enabled: true}},
		LinkSnapshots: map[string]config.LinkSnapshot{
			"cursor": {SkillIDs: []string{"foo", "missing"}, SavedAt: "t", Count: 2},
		},
	}
	entries := []domain.SkillEntry{
		{ID: "foo", HubPath: fooHub, Locations: []domain.SkillLocation{{ToolID: "skills", Kind: domain.KindHub, Path: fooHub}}},
		{ID: "bar", Locations: []domain.SkillLocation{{ToolID: "skills", Kind: domain.KindHub, Path: barHub}}},
	}

	res, err := Enable(&cfg, entries, []string{"cursor"}, "restore")
	if err != nil {
		t.Fatal(err)
	}
	if res.Totals.Linked != 1 {
		t.Fatalf("linked=%d want 1", res.Totals.Linked)
	}
	if _, err := os.Lstat(filepath.Join(toolRoot, "foo")); err != nil {
		t.Fatal(err)
	}

	res2, err := Enable(&cfg, entries, []string{"cursor"}, "all")
	if err != nil {
		t.Fatal(err)
	}
	if res2.Totals.Linked < 1 {
		t.Fatalf("all should link bar, got %+v", res2)
	}
	if _, err := os.Lstat(filepath.Join(toolRoot, "bar")); err != nil {
		t.Fatal(err)
	}
}

func TestEnableRestoreNoSnapshotSkips(t *testing.T) {
	cfg := config.Config{
		Tools: []config.ToolMapping{{ID: "cursor", Path: t.TempDir(), Enabled: true}},
	}
	res, err := Enable(&cfg, nil, []string{"cursor"}, "restore")
	if err != nil {
		t.Fatal(err)
	}
	if res.Tools[0].Skipped < 1 {
		t.Fatalf("want skipped, got %+v", res.Tools[0])
	}
}

func TestEnableInvalidMode(t *testing.T) {
	cfg := config.Config{}
	_, err := Enable(&cfg, nil, []string{"cursor"}, "nope")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestSnapshotCovers(t *testing.T) {
	if !snapshotCovers([]string{"foo", "bar"}, []string{"foo"}) {
		t.Fatal("retry remaining ids should stay covered")
	}
	if snapshotCovers([]string{"foo"}, []string{"foo", "bar"}) {
		t.Fatal("a new disable with extra ids must replace the snapshot")
	}
	if !snapshotCovers([]string{"keep"}, nil) {
		t.Fatal("empty current list is covered")
	}
}

func TestDisableRetryKeepsBroaderSnapshot(t *testing.T) {
	canSymlink(t)
	root := t.TempDir()
	hub := filepath.Join(root, "hub", "foo")
	toolRoot := filepath.Join(root, "cursor")
	if err := os.MkdirAll(hub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hub, "SKILL.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(toolRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(toolRoot, "foo")
	if err := linker.EnsureSymlink(linkPath, hub); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		HubPath: filepath.Join(root, "hub"),
		Tools:   []config.ToolMapping{{ID: "cursor", Path: toolRoot, Enabled: true}},
		LinkSnapshots: map[string]config.LinkSnapshot{
			"cursor": {SkillIDs: []string{"foo", "bar"}, SavedAt: "old", Count: 2},
		},
	}
	entries := []domain.SkillEntry{{
		ID: "foo",
		Locations: []domain.SkillLocation{
			{ToolID: "cursor", Path: linkPath, Kind: domain.KindSymlink},
		},
	}}
	if _, err := Disable(&cfg, entries, []string{"cursor"}); err != nil {
		t.Fatal(err)
	}
	snap := cfg.LinkSnapshots["cursor"]
	if snap.Count != 2 || len(snap.SkillIDs) != 2 || snap.SkillIDs[0] != "foo" || snap.SkillIDs[1] != "bar" {
		t.Fatalf("retry must keep broader snapshot, got %+v", snap)
	}
}

func TestEnableSkipsRelativeLinkIndependentOfCwd(t *testing.T) {
	canSymlink(t)
	root := t.TempDir()
	hubRoot := filepath.Join(root, "hub")
	fooHub := filepath.Join(hubRoot, "default", "foo")
	toolRoot := filepath.Join(root, "cursor")
	for _, d := range []string{fooHub, toolRoot} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(fooHub, "SKILL.md"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(toolRoot, "foo")
	rel, err := filepath.Rel(filepath.Dir(linkPath), fooHub)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(rel, linkPath); err != nil {
		t.Fatal(err)
	}
	t.Chdir(t.TempDir())
	cfg := config.Config{
		HubPath: hubRoot,
		Tools:   []config.ToolMapping{{ID: "cursor", Path: toolRoot, Enabled: true}},
	}
	entries := []domain.SkillEntry{
		{ID: "foo", HubPath: fooHub, Locations: []domain.SkillLocation{{ToolID: "skills", Kind: domain.KindHub, Path: fooHub}}},
	}
	res, err := Enable(&cfg, entries, []string{"cursor"}, "all")
	if err != nil {
		t.Fatal(err)
	}
	if res.Totals.Linked != 0 {
		t.Fatalf("already-correct relative link should skip, linked=%d", res.Totals.Linked)
	}
	if res.Totals.Skipped < 1 {
		t.Fatalf("want skipped, got %+v", res.Totals)
	}
	got, err := os.Readlink(linkPath)
	if err != nil {
		t.Fatal(err)
	}
	if got != rel {
		t.Fatalf("rewrote relative link %q to %q", rel, got)
	}
}
