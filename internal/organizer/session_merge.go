package organizer

import (
	"path/filepath"
	"sort"
	"strings"

	"SkillsManager/internal/domain"
)

func (s *Session) dropDeepExtrasLocked(succeeded []domain.ReportItem) {
	if len(s.extras) == 0 || len(succeeded) == 0 {
		return
	}
	done := make(map[string]struct{}, len(succeeded))
	for _, item := range succeeded {
		id := strings.TrimSpace(item.SkillID)
		if id == "" {
			continue
		}
		done[id] = struct{}{}
	}
	out := make([]domain.SkillEntry, 0, len(s.extras))
	for _, e := range s.extras {
		if _, ok := done[e.ID]; ok {
			continue
		}
		out = append(out, e)
	}
	s.extras = out
}

// newDeepScanExtras returns deep-scan findings whose skill IDs are not already managed.
func newDeepScanExtras(base, extras []domain.SkillEntry) []domain.SkillEntry {
	if len(extras) == 0 {
		return nil
	}
	known := make(map[string]struct{}, len(base))
	for _, e := range base {
		known[e.ID] = struct{}{}
	}
	out := make([]domain.SkillEntry, 0, len(extras))
	for _, e := range extras {
		if _, ok := known[e.ID]; ok {
			continue
		}
		out = append(out, e)
	}
	return out
}

func mergeSkillEntries(base, extras []domain.SkillEntry) []domain.SkillEntry {
	if len(extras) == 0 {
		return base
	}
	byID := make(map[string]int, len(base))
	out := make([]domain.SkillEntry, len(base))
	copy(out, base)
	for i := range out {
		byID[out[i].ID] = i
	}
	for _, extra := range extras {
		if idx, ok := byID[extra.ID]; ok {
			out[idx].Locations = mergeLocations(out[idx].Locations, extra.Locations)
			if out[idx].HubPath == "" {
				out[idx].HubPath = extra.HubPath
			}
			if out[idx].Name == "" {
				out[idx].Name = extra.Name
			}
			if out[idx].Description == "" {
				out[idx].Description = extra.Description
			}
			continue
		}
		byID[extra.ID] = len(out)
		out = append(out, extra)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func mergeLocations(existing, extras []domain.SkillLocation) []domain.SkillLocation {
	seen := make(map[string]struct{}, len(existing))
	for _, loc := range existing {
		seen[locKey(loc)] = struct{}{}
	}
	out := append([]domain.SkillLocation(nil), existing...)
	for _, loc := range extras {
		k := locKey(loc)
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, loc)
	}
	return out
}

func locKey(loc domain.SkillLocation) string {
	return loc.ToolID + "\x00" + filepath.Clean(loc.Path) + "\x00" + string(loc.Kind)
}
