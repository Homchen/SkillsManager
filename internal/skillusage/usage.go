package skillusage

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"SkillsManager/internal/domain"
	"SkillsManager/internal/skilli18n"
)

// FileName is the usage stats filename under ~/.skillsmanager/skills/.
const FileName = "skill-usage.json"

type fileRecord struct {
	Count      int            `json:"count"`
	LastUsedAt string         `json:"lastUsedAt"`
	Paths      []string       `json:"paths"`
	Daily      map[string]int `json:"daily"`
}

type fileData struct {
	Version int                     `json:"version"`
	Skills  map[string]fileRecord   `json:"skills"`
}

// DefaultPath returns ~/.skillsmanager/skills/skill-usage.json.
func DefaultPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".skillsmanager", "skills", FileName), nil
}

// Load reads usage JSON. Missing file yields empty data.
func Load(path string) (fileData, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fileData{Version: 2, Skills: map[string]fileRecord{}}, nil
		}
		return fileData{}, err
	}
	var data fileData
	if err := json.Unmarshal(raw, &data); err != nil {
		return fileData{}, err
	}
	if data.Skills == nil {
		data.Skills = map[string]fileRecord{}
	}
	return data, nil
}

func normalizePath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	cleaned := filepath.Clean(p)
	return strings.ToLower(cleaned)
}

func skillDirOfSKILL(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	base := filepath.Base(path)
	if !strings.EqualFold(base, "SKILL.md") {
		// Path may already be a skill directory.
		return filepath.Clean(path)
	}
	return filepath.Clean(filepath.Dir(path))
}

func translationSkillID(path, translationRoot string) (string, bool) {
	skillDir := skillDirOfSKILL(path)
	if skillDir == "" || translationRoot == "" {
		return "", false
	}
	root := filepath.Clean(translationRoot)
	rel, err := filepath.Rel(root, skillDir)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return "", false
	}
	parts := strings.Split(rel, string(filepath.Separator))
	if len(parts) < 2 {
		return "", false
	}
	id := strings.TrimSpace(parts[0])
	if id == "" {
		return "", false
	}
	return id, true
}

func buildPathIndex(entries []domain.SkillEntry) map[string]string {
	index := make(map[string]string)
	add := func(skillID, p string) {
		dir := normalizePath(skillDirOfSKILL(p))
		if dir == "" || skillID == "" {
			return
		}
		index[dir] = skillID
		index[normalizePath(filepath.Join(skillDirOfSKILL(p), "SKILL.md"))] = skillID
	}

	for _, e := range entries {
		add(e.ID, e.HubPath)
		for _, loc := range e.Locations {
			add(e.ID, loc.Path)
			if loc.LinkTarget != "" {
				add(e.ID, loc.LinkTarget)
			}
		}
	}
	return index
}

func resolveRecordSkillID(
	key string,
	rec fileRecord,
	managedIDs map[string]struct{},
	pathIndex map[string]string,
	translationRoot string,
) (string, bool) {
	if _, ok := managedIDs[key]; ok {
		return key, true
	}
	for _, p := range rec.Paths {
		dir := normalizePath(skillDirOfSKILL(p))
		if id, ok := pathIndex[dir]; ok {
			return id, true
		}
		if id, ok := pathIndex[normalizePath(p)]; ok {
			return id, true
		}
		if id, ok := translationSkillID(p, translationRoot); ok {
			if _, managed := managedIDs[id]; managed {
				return id, true
			}
		}
	}
	return "", false
}

func mergeDaily(dst map[string]int, src map[string]int) {
	for day, n := range src {
		if n <= 0 {
			continue
		}
		dst[day] += n
	}
}

func laterTimestamp(a, b string) string {
	if a == "" {
		return b
	}
	if b == "" {
		return a
	}
	if b > a {
		return b
	}
	return a
}

// Summarize maps raw usage records onto currently managed skills only.
func Summarize(data fileData, entries []domain.SkillEntry, translationRoot string) domain.SkillUsageSummary {
	managedIDs := make(map[string]struct{}, len(entries))
	byID := make(map[string]domain.SkillEntry, len(entries))
	for _, e := range entries {
		managedIDs[e.ID] = struct{}{}
		byID[e.ID] = e
	}

	pathIndex := buildPathIndex(entries)
	agg := make(map[string]*domain.SkillUsageItem, len(entries))
	for _, e := range entries {
		agg[e.ID] = &domain.SkillUsageItem{
			ID:    e.ID,
			Name:  e.Name,
			Daily: map[string]int{},
		}
	}

	hasAny := false
	for key, rec := range data.Skills {
		id, ok := resolveRecordSkillID(key, rec, managedIDs, pathIndex, translationRoot)
		if !ok {
			continue
		}
		item := agg[id]
		if item == nil {
			continue
		}
		if rec.Count > 0 || len(rec.Daily) > 0 {
			hasAny = true
		}
		item.Count += rec.Count
		item.LastUsedAt = laterTimestamp(item.LastUsedAt, rec.LastUsedAt)
		if item.Daily == nil {
			item.Daily = map[string]int{}
		}
		mergeDaily(item.Daily, rec.Daily)
	}

	out := make([]domain.SkillUsageItem, 0, len(entries))
	for _, e := range entries {
		item := agg[e.ID]
		if item.Daily == nil {
			item.Daily = map[string]int{}
		}
		if item.Name == "" {
			item.Name = byID[e.ID].Name
		}
		out = append(out, *item)
	}

	return domain.SkillUsageSummary{
		Skills:       out,
		HasAnyRecord: hasAny,
	}
}

// LoadSummary loads the default usage file and summarizes against managed skills.
func LoadSummary(entries []domain.SkillEntry, hubPath string) (domain.SkillUsageSummary, error) {
	path, err := DefaultPath()
	if err != nil {
		return domain.SkillUsageSummary{}, err
	}
	data, err := Load(path)
	if err != nil {
		return domain.SkillUsageSummary{}, err
	}
	translationRoot := skilli18n.New(hubPath).Root()
	return Summarize(data, entries, translationRoot), nil
}
