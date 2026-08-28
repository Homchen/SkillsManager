package config

import (
	"fmt"
	"strings"
)

// SuggestToolID derives a tool id from a directory path, aligning with SettingsPage.addTool:
// strip trailing separators, use last segment (or parent if segment is "skills"),
// strip a leading '.', default to "tool", then suffix -2/-3 on case-insensitive conflicts.
func SuggestToolID(dir string, existing []ToolMapping) string {
	trimmed := strings.TrimRight(dir, `/\`)
	parts := strings.FieldsFunc(trimmed, func(r rune) bool {
		return r == '/' || r == '\\'
	})
	base := ""
	if len(parts) > 0 {
		base = parts[len(parts)-1]
	}
	if strings.EqualFold(base, "skills") && len(parts) >= 2 {
		base = parts[len(parts)-2]
	}
	base = strings.TrimPrefix(base, ".")
	base = strings.TrimSpace(base)
	if base == "" {
		base = "tool"
	}

	if !idTaken(base, existing) {
		return base
	}
	for n := 2; ; n++ {
		candidate := fmt.Sprintf("%s-%d", base, n)
		if !idTaken(candidate, existing) {
			return candidate
		}
	}
}

func idTaken(id string, existing []ToolMapping) bool {
	for _, t := range existing {
		if strings.EqualFold(strings.TrimSpace(t.ID), id) {
			return true
		}
	}
	return false
}
