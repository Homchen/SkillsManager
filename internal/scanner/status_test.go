package scanner

import (
	"os"
	"path/filepath"
	"testing"

	"SkillsManager/internal/domain"
)

func writeSkill(t *testing.T, dir, body string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDeriveStatus(t *testing.T) {
	root := t.TempDir()
	hub := filepath.Join(root, "hub", "default", "demo")
	copySame := filepath.Join(root, "copy-same")
	copyDiff := filepath.Join(root, "copy-diff")
	writeSkill(t, hub, "---\nname: Demo\n---\nbody\n")
	writeSkill(t, copySame, "---\nname: Demo\n---\nbody\n")
	writeSkill(t, copyDiff, "---\nname: Demo\n---\nother\n")

	tests := []struct {
		name string
		e    *domain.SkillEntry
		want domain.SkillStatus
	}{
		{
			name: "hub only",
			e: &domain.SkillEntry{
				ID:      "demo",
				HubPath: hub,
				Locations: []domain.SkillLocation{
					{Kind: domain.KindHub, Path: hub},
				},
			},
			want: domain.StatusHubOnly,
		},
		{
			name: "hub path without hub location counts as hub",
			e: &domain.SkillEntry{
				ID:      "demo",
				HubPath: hub,
			},
			want: domain.StatusHubOnly,
		},
		{
			name: "normal when symlink points to hub",
			e: &domain.SkillEntry{
				ID:      "demo",
				HubPath: hub,
				Locations: []domain.SkillLocation{
					{Kind: domain.KindHub, Path: hub},
					{Kind: domain.KindSymlink, Path: filepath.Join(root, "link"), LinkTarget: hub},
				},
			},
			want: domain.StatusNormal,
		},
		{
			name: "broken when symlink points elsewhere",
			e: &domain.SkillEntry{
				ID:      "demo",
				HubPath: hub,
				Locations: []domain.SkillLocation{
					{Kind: domain.KindHub, Path: hub},
					{Kind: domain.KindSymlink, Path: filepath.Join(root, "link"), LinkTarget: copySame},
				},
			},
			want: domain.StatusBrokenLink,
		},
		{
			name: "broken when symlink has empty target",
			e: &domain.SkillEntry{
				ID:      "demo",
				HubPath: hub,
				Locations: []domain.SkillLocation{
					{Kind: domain.KindHub, Path: hub},
					{Kind: domain.KindSymlink, Path: filepath.Join(root, "link")},
				},
			},
			want: domain.StatusBrokenLink,
		},
		{
			name: "broken link location",
			e: &domain.SkillEntry{
				ID: "demo",
				Locations: []domain.SkillLocation{
					{Kind: domain.KindBrokenLink, Path: filepath.Join(root, "dead")},
				},
			},
			want: domain.StatusBrokenLink,
		},
		{
			name: "symlink only without hub",
			e: &domain.SkillEntry{
				ID: "demo",
				Locations: []domain.SkillLocation{
					{Kind: domain.KindSymlink, Path: filepath.Join(root, "link"), LinkTarget: hub},
				},
			},
			want: domain.StatusBrokenLink,
		},
		{
			name: "identical real copy is real_copy_only",
			e: &domain.SkillEntry{
				ID:      "demo",
				HubPath: hub,
				Locations: []domain.SkillLocation{
					{Kind: domain.KindHub, Path: hub},
					{Kind: domain.KindRealCopy, Path: copySame},
				},
			},
			want: domain.StatusRealCopyOnly,
		},
		{
			name: "differing real copy is conflict",
			e: &domain.SkillEntry{
				ID:      "demo",
				HubPath: hub,
				Locations: []domain.SkillLocation{
					{Kind: domain.KindHub, Path: hub},
					{Kind: domain.KindRealCopy, Path: copyDiff},
				},
			},
			want: domain.StatusConflict,
		},
		{
			name: "real copy alone is real_copy_only",
			e: &domain.SkillEntry{
				ID: "demo",
				Locations: []domain.SkillLocation{
					{Kind: domain.KindRealCopy, Path: copySame},
				},
			},
			want: domain.StatusRealCopyOnly,
		},
		{
			name: "empty locations defaults to hub_only",
			e: &domain.SkillEntry{
				ID: "demo",
			},
			want: domain.StatusHubOnly,
		},
		{
			name: "broken takes precedence over hub-only when no real copy",
			e: &domain.SkillEntry{
				ID:      "demo",
				HubPath: hub,
				Locations: []domain.SkillLocation{
					{Kind: domain.KindHub, Path: hub},
					{Kind: domain.KindBrokenLink, Path: filepath.Join(root, "dead")},
				},
			},
			want: domain.StatusBrokenLink,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := deriveStatus(tt.e)
			if got != tt.want {
				t.Fatalf("deriveStatus()=%s want=%s", got, tt.want)
			}
		})
	}
}

func TestAllSymlinksPointToHub(t *testing.T) {
	hub := filepath.Join(t.TempDir(), "hub", "demo")
	if !allSymlinksPointToHub(nil, hub) {
		// empty links => false
	} else {
		t.Fatal("empty links should be false")
	}
	if allSymlinksPointToHub([]domain.SkillLocation{{LinkTarget: hub}}, "") {
		t.Fatal("empty hub should be false")
	}
	links := []domain.SkillLocation{
		{LinkTarget: hub},
		{LinkTarget: hub},
	}
	if !allSymlinksPointToHub(links, hub) {
		t.Fatal("matching targets should be true")
	}
	links[1].LinkTarget = filepath.Join(t.TempDir(), "other")
	if allSymlinksPointToHub(links, hub) {
		t.Fatal("mismatched target should be false")
	}
}
