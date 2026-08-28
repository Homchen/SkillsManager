package config

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"

	"SkillsManager/internal/fsutil"
)

// DefaultOpenAIBaseURL is the public OpenAI API root used when settings omit a base URL.
const DefaultOpenAIBaseURL = "https://api.openai.com/v1"

// DefaultOpenAIModel is the default chat-completions model for AI translation.
const DefaultOpenAIModel = "gpt-5.6-terra"

// DefaultOpenAITemperature is the default chat-completions temperature for AI translation.
const DefaultOpenAITemperature = 0.2

// ClearSecret is the sentinel written to OpenAIAPIKey or MicrosoftTranslatorKey
// to delete the matching ~/.skillsmanager/.env entry. An empty string means
// leave the existing .env value unchanged.
const ClearSecret = "\x00"

// NormalizeOpenAITemperature clamps temperature to the [0, 1] range used by AI translation.
// Out-of-range or non-finite values fall back to DefaultOpenAITemperature.
func NormalizeOpenAITemperature(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 1 {
		return DefaultOpenAITemperature
	}
	return v
}

type ToolMapping struct {
	ID      string `json:"id"`
	Path    string `json:"path"`
	Enabled bool   `json:"enabled"`
	IsHub   bool   `json:"isHub,omitempty"` // 兼容旧配置；加载后会剔除，源仓仅用 HubPath
}

type LinkSnapshot struct {
	SkillIDs []string `json:"skillIds"`
	SavedAt  string   `json:"savedAt"`
	Count    int      `json:"count"`
}

type Config struct {
	HubPath                   string                  `json:"hubPath"`
	Tools                     []ToolMapping           `json:"tools"`
	TrashRetentionDays        int                     `json:"trashRetentionDays"`
	DeepScanIgnoreExtra       []string                `json:"deepScanIgnoreExtra"`
	AllowPermanentDelete      bool                    `json:"allowPermanentDelete"`
	LinkSnapshots             map[string]LinkSnapshot `json:"linkSnapshots,omitempty"`
	SkillsLayout              string                  `json:"skillsLayout,omitempty"`         // "flat" | "grouped"；空视为 flat
	CollapsedSkillGroups      []string                `json:"collapsedSkillGroups,omitempty"` // 技能页分组视图中已折叠的分组 ID
	TranslationEngine         string                  `json:"translationEngine,omitempty"`
	TranslationTargetLanguage string                  `json:"translationTargetLanguage,omitempty"`
	MicrosoftTranslatorKey    string                  `json:"microsoftTranslatorKey,omitempty"`
	MicrosoftTranslatorRegion string                  `json:"microsoftTranslatorRegion,omitempty"`
	OpenAIBaseURL             string                  `json:"openAIBaseURL,omitempty"`
	OpenAIAPIKey              string                  `json:"openAIAPIKey,omitempty"`
	OpenAIModel               string                  `json:"openAIModel,omitempty"`
	OpenAITemperature         float64                 `json:"openAITemperature"`
	LogDebug                  bool                    `json:"logDebug,omitempty"`
}

func Default() Config {
	home, _ := os.UserHomeDir()
	hub := filepath.Join(home, ".skillsmanager", "skills")
	return Config{
		HubPath:                   hub,
		TrashRetentionDays:        7,
		TranslationEngine:         "microsoft_android",
		TranslationTargetLanguage: "zh-CN",
		MicrosoftTranslatorRegion: "eastasia",
		OpenAIBaseURL:             DefaultOpenAIBaseURL,
		OpenAIModel:               DefaultOpenAIModel,
		OpenAITemperature:         DefaultOpenAITemperature,
		Tools: []ToolMapping{
			{ID: "cursor", Path: filepath.Join(home, ".cursor", "skills"), Enabled: true},
			{ID: "claude", Path: filepath.Join(home, ".claude", "skills"), Enabled: true},
			{ID: "agents", Path: filepath.Join(home, ".agents", "skills"), Enabled: true},
			{ID: "opencode", Path: filepath.Join(home, ".config", "opencode", "skills"), Enabled: true},
			{ID: "codex", Path: filepath.Join(home, ".codex", "skills"), Enabled: true},
			{ID: "deepseek-harness", Path: filepath.Join(home, ".dsh", "skills"), Enabled: true},
			{ID: "pi", Path: filepath.Join(home, ".pi", "agent", "skills"), Enabled: true},
			{ID: "omp", Path: filepath.Join(home, ".omp", "agent", "skills"), Enabled: true},
			{ID: "workbuddy", Path: filepath.Join(home, ".workbuddy", "skills"), Enabled: true},
			{ID: "qoder", Path: filepath.Join(home, ".qoder", "skills"), Enabled: true},
			{ID: "qoder-cn", Path: filepath.Join(home, ".qoder-cn", "skills"), Enabled: true},
			{ID: "trae", Path: filepath.Join(home, ".trae", "skills"), Enabled: true},
			{ID: "trae-cn", Path: filepath.Join(home, ".trae-cn", "skills"), Enabled: true},
		},
	}
}

func Load(path string) (Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Default(), nil
		}
		return Config{}, err
	}
	var cfg Config
	if err := json.Unmarshal(b, &cfg); err != nil {
		return Config{}, err
	}
	if cfg.HubPath == "" {
		cfg.HubPath = Default().HubPath
	}
	if cfg.TrashRetentionDays <= 0 {
		cfg.TrashRetentionDays = 7
	}
	if strings.TrimSpace(cfg.TranslationEngine) == "" {
		cfg.TranslationEngine = "microsoft_android"
	}
	if strings.TrimSpace(cfg.TranslationTargetLanguage) == "" {
		cfg.TranslationTargetLanguage = "zh-CN"
	}
	if strings.TrimSpace(cfg.MicrosoftTranslatorRegion) == "" {
		cfg.MicrosoftTranslatorRegion = "eastasia"
	}
	if strings.TrimSpace(cfg.OpenAIBaseURL) == "" {
		cfg.OpenAIBaseURL = DefaultOpenAIBaseURL
	}
	if strings.TrimSpace(cfg.OpenAIModel) == "" {
		cfg.OpenAIModel = DefaultOpenAIModel
	}
	// Older settings.json files omit openAITemperature; treat absence as default
	// so a literal 0 saved by the user is preserved.
	var rawKeys map[string]json.RawMessage
	if err := json.Unmarshal(b, &rawKeys); err == nil {
		if _, ok := rawKeys["openAITemperature"]; !ok {
			cfg.OpenAITemperature = DefaultOpenAITemperature
		} else {
			cfg.OpenAITemperature = NormalizeOpenAITemperature(cfg.OpenAITemperature)
		}
	} else {
		cfg.OpenAITemperature = NormalizeOpenAITemperature(cfg.OpenAITemperature)
	}
	hadLegacyOpenAI := strings.TrimSpace(cfg.OpenAIAPIKey) != ""
	hadLegacyMS := strings.TrimSpace(cfg.MicrosoftTranslatorKey) != ""
	if err := cfg.hydrateOpenAIAPIKey(); err != nil {
		return Config{}, err
	}
	if err := cfg.hydrateMicrosoftTranslatorKey(); err != nil {
		return Config{}, err
	}
	if hadLegacyOpenAI || hadLegacyMS {
		_ = stripLegacySecretKeys(path)
	}
	cfg.NormalizeTools()
	if len(cfg.Tools) == 0 {
		cfg.Tools = Default().Tools
	} else {
		cfg.MergeDefaultTools()
	}
	return cfg, nil
}

// HydrateSecrets loads translation keys from ~/.skillsmanager/.env into c.
// It does not write settings.json. A missing .env is not an error.
func (c *Config) HydrateSecrets() error {
	if c == nil {
		return nil
	}
	if err := c.hydrateOpenAIAPIKey(); err != nil {
		return err
	}
	return c.hydrateMicrosoftTranslatorKey()
}

// SaveSettingsJSON writes settings.json with secret fields stripped.
// It never reads or writes ~/.skillsmanager/.env.
func (c Config) SaveSettingsJSON(path string) error {
	c.NormalizeTools()
	c.OpenAIAPIKey = ""
	c.MicrosoftTranslatorKey = ""
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

// RecoverCorruptSettings hydrates keys from .env, then writes a default
// settings.json without modifying .env. Used when Load fails on corrupt JSON.
func RecoverCorruptSettings(path string) (Config, error) {
	cfg := Default()
	_ = cfg.HydrateSecrets()
	return cfg, cfg.SaveSettingsJSON(path)
}

func (c Config) Save(path string) error {
	// Write JSON first so a failed settings.json write cannot leave .env updated.
	if err := c.SaveSettingsJSON(path); err != nil {
		return err
	}
	if err := persistEnvSecret(c.OpenAIAPIKey, SaveOpenAIAPIKey); err != nil {
		return err
	}
	return persistEnvSecret(c.MicrosoftTranslatorKey, SaveMicrosoftTranslatorKey)
}

func persistEnvSecret(value string, save func(string) error) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	if trimmed == ClearSecret {
		return save("")
	}
	return save(trimmed)
}

// hydrateOpenAIAPIKey prefers ~/.skillsmanager/.env; migrates a legacy JSON key once.
func (c *Config) hydrateOpenAIAPIKey() error {
	if c == nil {
		return nil
	}
	legacy := strings.TrimSpace(c.OpenAIAPIKey)
	if legacy == ClearSecret {
		legacy = ""
	}
	envKey, err := LoadOpenAIAPIKey()
	if err != nil {
		return err
	}
	if envKey != "" {
		c.OpenAIAPIKey = envKey
		return nil
	}
	if legacy == "" {
		c.OpenAIAPIKey = ""
		return nil
	}
	if err := SaveOpenAIAPIKey(legacy); err != nil {
		return err
	}
	c.OpenAIAPIKey = legacy
	return nil
}

func (c *Config) hydrateMicrosoftTranslatorKey() error {
	if c == nil {
		return nil
	}
	legacy := strings.TrimSpace(c.MicrosoftTranslatorKey)
	if legacy == ClearSecret {
		legacy = ""
	}
	envKey, err := LoadMicrosoftTranslatorKey()
	if err != nil {
		return err
	}
	if envKey != "" {
		c.MicrosoftTranslatorKey = envKey
		return nil
	}
	if legacy == "" {
		c.MicrosoftTranslatorKey = ""
		return nil
	}
	if err := SaveMicrosoftTranslatorKey(legacy); err != nil {
		return err
	}
	c.MicrosoftTranslatorKey = legacy
	return nil
}

// NormalizeTools 移除源仓条目：源仓只由 HubPath 表示，不出现在工具目录中。
func (c *Config) NormalizeTools() {
	if c == nil {
		return
	}
	out := make([]ToolMapping, 0, len(c.Tools))
	for _, t := range c.Tools {
		if t.IsHub {
			continue
		}
		if t.Path != "" && fsutil.SamePath(t.Path, c.HubPath) {
			continue
		}
		t.IsHub = false
		out = append(out, t)
	}
	c.Tools = out
}

// MergeDefaultTools 补齐内置工具映射（按 ID，不覆盖用户已有项）。
func (c *Config) MergeDefaultTools() {
	if c == nil {
		return
	}
	have := make(map[string]struct{}, len(c.Tools))
	for _, t := range c.Tools {
		have[strings.ToLower(strings.TrimSpace(t.ID))] = struct{}{}
	}
	for _, d := range Default().Tools {
		id := strings.ToLower(strings.TrimSpace(d.ID))
		if id == "" {
			continue
		}
		if _, ok := have[id]; ok {
			continue
		}
		c.Tools = append(c.Tools, d)
		have[id] = struct{}{}
	}
}

// RenameCollapsedSkillGroup migrates a collapsed-group ID after rename.
func (c *Config) RenameCollapsedSkillGroup(oldID, newID string) {
	if c == nil {
		return
	}
	oldID = strings.TrimSpace(oldID)
	newID = strings.TrimSpace(newID)
	if oldID == "" || newID == "" || oldID == newID {
		return
	}
	out := make([]string, 0, len(c.CollapsedSkillGroups))
	hasNew := false
	for _, id := range c.CollapsedSkillGroups {
		id = strings.TrimSpace(id)
		if id == "" || id == oldID {
			continue
		}
		if id == newID {
			hasNew = true
		}
		out = append(out, id)
	}
	if !hasNew {
		// Only keep new ID if the old one was collapsed.
		for _, id := range c.CollapsedSkillGroups {
			if strings.TrimSpace(id) == oldID {
				out = append(out, newID)
				break
			}
		}
	}
	c.CollapsedSkillGroups = out
}

// RemoveCollapsedSkillGroup drops a group ID from the collapsed list.
func (c *Config) RemoveCollapsedSkillGroup(id string) {
	if c == nil {
		return
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return
	}
	out := make([]string, 0, len(c.CollapsedSkillGroups))
	for _, cur := range c.CollapsedSkillGroups {
		cur = strings.TrimSpace(cur)
		if cur == "" || cur == id {
			continue
		}
		out = append(out, cur)
	}
	c.CollapsedSkillGroups = out
}

// PruneCollapsedSkillGroups keeps only IDs present in valid.
func (c *Config) PruneCollapsedSkillGroups(valid map[string]struct{}) bool {
	if c == nil {
		return false
	}
	if len(c.CollapsedSkillGroups) == 0 {
		return false
	}
	out := make([]string, 0, len(c.CollapsedSkillGroups))
	changed := false
	seen := map[string]struct{}{}
	for _, id := range c.CollapsedSkillGroups {
		id = strings.TrimSpace(id)
		if id == "" {
			changed = true
			continue
		}
		if _, ok := valid[id]; !ok {
			changed = true
			continue
		}
		if _, dup := seen[id]; dup {
			changed = true
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	if !changed && len(out) == len(c.CollapsedSkillGroups) {
		return false
	}
	c.CollapsedSkillGroups = out
	return true
}

// EnsureHubDir 确保源仓目录及默认分组目录存在。
// 默认分组名与 domain.DefaultGroup（"default"）一致；此处写死字符串以避免 config→domain 依赖。
func EnsureHubDir(hubPath string) error {
	hubPath = strings.TrimSpace(hubPath)
	if hubPath == "" {
		return fmt.Errorf("源仓路径为空")
	}
	if err := os.MkdirAll(hubPath, 0o755); err != nil {
		return err
	}
	return os.MkdirAll(filepath.Join(hubPath, "default"), 0o755)
}

func stripLegacySecretKeys(path string) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	_, hadOpenAI := raw["openAIAPIKey"]
	_, hadMS := raw["microsoftTranslatorKey"]
	if !hadOpenAI && !hadMS {
		return nil
	}
	delete(raw, "openAIAPIKey")
	delete(raw, "microsoftTranslatorKey")
	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(out, '\n'), 0o644)
}

func (c Config) EnabledNonHubTools() []ToolMapping {
	out := make([]ToolMapping, 0, len(c.Tools))
	for _, t := range c.Tools {
		if t.Enabled && !t.IsHub && !fsutil.SamePath(t.Path, c.HubPath) {
			out = append(out, t)
		}
	}
	return out
}

func DefaultSettingsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".skillsmanager", "settings.json"), nil
}
