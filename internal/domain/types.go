package domain

type LocationKind string

const (
	KindHub        LocationKind = "hub"
	KindSymlink    LocationKind = "symlink"
	KindRealCopy   LocationKind = "real_copy"
	KindBrokenLink LocationKind = "broken_link"
)

type SkillStatus string

const (
	StatusNormal       SkillStatus = "normal"
	StatusRealCopyOnly SkillStatus = "real_copy_only"
	StatusConflict     SkillStatus = "conflict"
	StatusBrokenLink   SkillStatus = "broken_link"
	StatusHubOnly      SkillStatus = "hub_only"
)

// DefaultGroup is the hub subdirectory for skills without an explicit group.
const DefaultGroup = "default"

type GroupInfo struct {
	ID string `json:"id"`
}

type SkillLocation struct {
	ToolID     string       `json:"toolId"`
	Path       string       `json:"path"`
	Kind       LocationKind `json:"kind"`
	LinkTarget string       `json:"linkTarget,omitempty"`
}

type SkillEntry struct {
	ID               string          `json:"id"`
	Name             string          `json:"name"`
	Description      string          `json:"description,omitempty"`
	Group            string          `json:"group,omitempty"`
	HubPath          string          `json:"hubPath,omitempty"`
	Status           SkillStatus     `json:"status"`
	Locations        []SkillLocation `json:"locations"`
	DefaultLanguage  string          `json:"defaultLanguage,omitempty"`
	TranslationCount int             `json:"translationCount,omitempty"`
}

// SkillI18nInfo describes available language versions for one skill.
type SkillI18nInfo struct {
	DefaultLanguage  string   `json:"defaultLanguage"`
	Languages        []string `json:"languages"`
	TranslationCount int      `json:"translationCount"`
}

// SkillUsageItem is one managed skill's aggregated usage stats.
type SkillUsageItem struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Count      int            `json:"count"`
	LastUsedAt string         `json:"lastUsedAt,omitempty"`
	Daily      map[string]int `json:"daily"`
}

// SkillUsageSummary is the API payload for the usage stats page and skill cards.
type SkillUsageSummary struct {
	Skills       []SkillUsageItem `json:"skills"`
	HasAnyRecord bool             `json:"hasAnyRecord"`
}

// SkillVersionRef identifies a skill and optional language version.
// Empty Language resolves to the current default (hub) version.
type SkillVersionRef struct {
	ID       string `json:"id"`
	Language string `json:"language"`
}

type ActionType string

const (
	ActionSkip               ActionType = "skip"
	ActionMoveToHub          ActionType = "move_to_hub"
	ActionReplaceWithSymlink ActionType = "replace_with_symlink"
	ActionMergeConflict      ActionType = "merge_conflict"
	ActionFixLink            ActionType = "fix_link"
	ActionSkippedByUser      ActionType = "skipped_by_user"
)

type OrganizeAction struct {
	SkillID  string     `json:"skillId"`
	Type     ActionType `json:"type"`
	Sources  []string   `json:"sources"`
	Selected bool       `json:"selected"`
	HubPath  string     `json:"hubPath,omitempty"` // 已在源仓时的真实路径（含自定义分组）；迁入默认组时为空
}

type FileConflictStatus string

const (
	FileOnlyA    FileConflictStatus = "only_a"
	FileOnlyB    FileConflictStatus = "only_b"
	FileBothSame FileConflictStatus = "both_same"
	FileBothDiff FileConflictStatus = "both_diff"
)

type FileChoice string

const (
	ChoiceKeepA  FileChoice = "keep_a"
	ChoiceKeepB  FileChoice = "keep_b"
	ChoiceManual FileChoice = "manual"
)

type ConflictFile struct {
	RelativePath  string             `json:"relativePath"`
	Status        FileConflictStatus `json:"status"`
	Choice        FileChoice         `json:"choice,omitempty"`
	MergedContent string             `json:"mergedContent,omitempty"`
	IsText        bool               `json:"isText"`
}

// ConflictFileTexts is the side-by-side text payload for both_diff merge UI.
type ConflictFileTexts struct {
	SkillID string `json:"skillId"`
	Rel     string `json:"rel"`
	SideA   string `json:"sideA"`
	SideB   string `json:"sideB"`
}

type ConflictSkill struct {
	SkillID        string         `json:"skillId"`
	SideA          string         `json:"sideA"`
	SideB          string         `json:"sideB"`
	Files          []ConflictFile `json:"files"`
	UserSkipped    bool           `json:"userSkipped"`
	Index          int            `json:"index"` // 1-based 冲突序号
	Total          int            `json:"total"`
	PendingSources []string       `json:"pendingSources,omitempty"` // 尚未作为 Side B 合并的真实副本
}

type OrganizePlan struct {
	Actions   []OrganizeAction `json:"actions"`
	Conflicts []ConflictSkill  `json:"conflicts"`
}

// CanExecuteResult is the organize gate check payload for the UI.
// Wails v2 only supports (T, error); do not return (bool, string, error).
type CanExecuteResult struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason"`
}

type ReportItem struct {
	SkillID string `json:"skillId"`
	Message string `json:"message"`
}

type SuggestedWorkdir struct {
	Path       string   `json:"path"`
	SkillIDs   []string `json:"skillIds"`
	SkillCount int      `json:"skillCount"`
}

type OrganizeReport struct {
	Succeeded         []ReportItem       `json:"succeeded"`
	Skipped           []ReportItem       `json:"skipped"`
	Failed            []ReportItem       `json:"failed"`
	SuggestedWorkdirs []SuggestedWorkdir `json:"suggestedWorkdirs,omitempty"`
}

type AddWorkdirsResult struct {
	Added   []ReportItem `json:"added"`
	Linked  []ReportItem `json:"linked"`
	Skipped []ReportItem `json:"skipped"`
	Failed  []ReportItem `json:"failed"`
}

// RestoreOrphanItem is a directory symlink outside tool roots that points into the hub
// (typically left by a mistaken deep-scan move_to_hub that relinked the original path).
type RestoreOrphanItem struct {
	LinkPath   string `json:"linkPath"`
	TargetPath string `json:"targetPath"`
	SkillID    string `json:"skillId"`
}

type RestoreOrphanReport struct {
	Succeeded []ReportItem `json:"succeeded"`
	Skipped   []ReportItem `json:"skipped"`
	Failed    []ReportItem `json:"failed"`
}

type TrashItem struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	TrashPath string `json:"trashPath"`
	DeletedAt string `json:"deletedAt"`
	ExpiresAt string `json:"expiresAt"`
}

type BulkLinkFailure struct {
	SkillID string `json:"skillId,omitempty"`
	Path    string `json:"path,omitempty"`
	Reason  string `json:"reason"`
}

type ToolBulkLinkResult struct {
	ToolID  string            `json:"toolId"`
	Linked  int               `json:"linked"`
	Removed int               `json:"removed"`
	Skipped int               `json:"skipped"`
	Failed  []BulkLinkFailure `json:"failed,omitempty"`
}

type BulkLinkTotals struct {
	Linked  int `json:"linked"`
	Removed int `json:"removed"`
	Skipped int `json:"skipped"`
	Failed  int `json:"failed"`
}

type BulkLinkResult struct {
	Tools  []ToolBulkLinkResult `json:"tools"`
	Totals BulkLinkTotals       `json:"totals"`
}

type ExportToolSkillsResult struct {
	ZipPath  string `json:"zipPath"`
	Exported int    `json:"exported"`
	Skipped  int    `json:"skipped"`
}

// Import skill item statuses.
const (
	ImportStatusImported = "imported"
	ImportStatusSkipped  = "skipped"
	ImportStatusFailed   = "failed"
)

type ImportSkillItem struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
}

type ImportSkillsResult struct {
	Imported int               `json:"imported"`
	Skipped  int               `json:"skipped"`
	Failed   int               `json:"failed"`
	Items    []ImportSkillItem `json:"items"`
}
