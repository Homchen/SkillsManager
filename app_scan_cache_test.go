package main

import (
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/scanner"
	"SkillsManager/internal/skilli18n"
)

func TestListSkillsDoesNotWriteI18nMetadata(t *testing.T) {
	a, hub := newTestApp(t)
	if err := a.CreateSkill("demo", "Demo", "", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	s := skilli18n.New(hub)
	metaPath := s.MetaPath("demo")
	before, err := os.ReadFile(metaPath)
	if err != nil {
		t.Fatal(err)
	}
	en := s.VersionPath("demo", "en")
	if err := os.MkdirAll(en, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(en, "SKILL.md"), []byte("---\nname: demo\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	entries, err := a.ListSkills()
	if err != nil {
		t.Fatal(err)
	}
	var demo domain.SkillEntry
	for _, e := range entries {
		if e.ID == "demo" {
			demo = e
			break
		}
	}
	if demo.ID == "" {
		t.Fatal("demo missing from ListSkills")
	}
	if demo.TranslationCount != 0 {
		t.Fatalf("ListSkills TranslationCount = %d, want 0", demo.TranslationCount)
	}
	after, err := os.ReadFile(metaPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("ListSkills wrote metadata:\n%s", after)
	}

	info, err := a.GetSkillI18n("demo")
	if err != nil {
		t.Fatal(err)
	}
	if info.TranslationCount != 1 {
		t.Fatalf("GetSkillI18n TranslationCount = %d, want 1", info.TranslationCount)
	}
}

func TestListMergedSingleflightSharesScan(t *testing.T) {
	a, _ := newTestApp(t)
	if err := a.CreateSkill("demo", "Demo", "", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	var scans atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	a.scanFn = func(cfg config.Config) ([]domain.SkillEntry, error) {
		scans.Add(1)
		once.Do(func() { close(started) })
		<-release
		return []domain.SkillEntry{{ID: "demo", Name: "Demo"}}, nil
	}

	var wg sync.WaitGroup
	wg.Add(2)
	errCh := make(chan error, 2)
	go func() {
		defer wg.Done()
		_, err := a.ListSkills()
		errCh <- err
	}()
	go func() {
		defer wg.Done()
		_, err := a.GetSkillUsageSummary()
		errCh <- err
	}()
	<-started
	close(release)
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatal(err)
		}
	}
	if got := scans.Load(); got != 1 {
		t.Fatalf("scans = %d, want 1", got)
	}
}

func TestListMergedRetriesAfterInvalidateDuringScan(t *testing.T) {
	a, _ := newTestApp(t)
	var scans atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	a.scanFn = func(cfg config.Config) ([]domain.SkillEntry, error) {
		n := scans.Add(1)
		if n == 1 {
			once.Do(func() { close(started) })
			<-release
			return []domain.SkillEntry{{ID: "stale"}}, nil
		}
		return []domain.SkillEntry{{ID: "fresh"}}, nil
	}

	errCh := make(chan error, 1)
	var got []domain.SkillEntry
	go func() {
		var err error
		got, err = a.listMerged()
		errCh <- err
	}()
	<-started
	a.invalidateScan()
	close(release)
	if err := <-errCh; err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "fresh" {
		t.Fatalf("listMerged = %+v, want fresh after invalidate", got)
	}
	if got := scans.Load(); got != 2 {
		t.Fatalf("scans = %d, want 2", got)
	}
}

func TestListSkillsSeesRootSkillAfterUsageSummaryCached(t *testing.T) {
	a, hub := newTestApp(t)
	writeRootSkill(t, filepath.Join(hub, "foo"))
	a.cfg.Tools = []config.ToolMapping{
		{ID: "skills", Path: hub, Enabled: true, IsHub: true},
	}

	if _, err := a.GetSkillUsageSummary(); err != nil {
		t.Fatal(err)
	}
	entries, err := a.ListSkills()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range entries {
		if e.ID == "foo" {
			found = true
			if e.Group != "default" {
				t.Fatalf("group = %q, want default after migrate", e.Group)
			}
			break
		}
	}
	if !found {
		t.Fatalf("ListSkills missing migrated root skill foo: %+v", entries)
	}
}

func TestListMergedReleasesWaitersIfScanPanics(t *testing.T) {
	a, _ := newTestApp(t)
	var scans atomic.Int32
	started := make(chan struct{})
	var once sync.Once
	a.scanFn = func(cfg config.Config) ([]domain.SkillEntry, error) {
		n := scans.Add(1)
		if n == 1 {
			once.Do(func() { close(started) })
			panic("scan boom")
		}
		return []domain.SkillEntry{{ID: "ok"}}, nil
	}

	leaderDone := make(chan struct{})
	go func() {
		defer func() {
			_ = recover()
			close(leaderDone)
		}()
		_, _ = a.listMerged()
	}()
	<-started

	waiterErr := make(chan error, 1)
	var waiterGot []domain.SkillEntry
	go func() {
		var err error
		waiterGot, err = a.listMerged()
		waiterErr <- err
	}()
	<-leaderDone

	select {
	case err := <-waiterErr:
		if err != nil {
			t.Fatal(err)
		}
		if len(waiterGot) != 1 || waiterGot[0].ID != "ok" {
			t.Fatalf("waiter = %+v, want recovered scan", waiterGot)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("waiter blocked after scan panic")
	}
}

func TestWriteAndCreateInvalidateScanCache(t *testing.T) {
	a, _ := newTestApp(t)
	if err := a.CreateSkill("demo", "Demo", "", "zh-CN"); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	a.nowFn = func() time.Time { return now }
	var scans atomic.Int32
	a.scanFn = func(cfg config.Config) ([]domain.SkillEntry, error) {
		scans.Add(1)
		return scanner.Scan(cfg)
	}

	if _, err := a.ListSkills(); err != nil {
		t.Fatal(err)
	}
	if _, err := a.ListSkills(); err != nil {
		t.Fatal(err)
	}
	if got := scans.Load(); got != 1 {
		t.Fatalf("TTL rescan: scans = %d, want 1", got)
	}

	ref := domain.SkillVersionRef{ID: "demo", Language: "zh-CN"}
	if err := a.WriteSkillFile(ref, "SKILL.md", "---\nname: Demo\ndescription: edited\n---\n"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.ListSkills(); err != nil {
		t.Fatal(err)
	}
	if got := scans.Load(); got != 2 {
		t.Fatalf("after WriteSkillFile scans = %d, want 2", got)
	}

	if err := a.CreateSkill("other", "Other", "", "en"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.ListSkills(); err != nil {
		t.Fatal(err)
	}
	if got := scans.Load(); got != 3 {
		t.Fatalf("after CreateSkill scans = %d, want 3", got)
	}
}
