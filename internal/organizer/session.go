package organizer

import (
	"errors"
	"fmt"
	"path/filepath"
	"sync"

	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
	"SkillsManager/internal/scanner"
	"SkillsManager/internal/trash"
)

// Session is the organize working state for the process lifetime: plan,
// deep-scan findings, restorable mistaken links, and suggested workdirs.
type Session struct {
	mu sync.Mutex

	plan              *domain.OrganizePlan
	extras            []domain.SkillEntry
	restoreOrphans    []domain.RestoreOrphanItem
	suggestedWorkdirs []domain.SuggestedWorkdir

	deepMu     sync.Mutex
	deepCancel chan struct{}
}

func NewSession() *Session {
	return &Session{}
}

func (s *Session) requirePlanLocked() (*domain.OrganizePlan, error) {
	if s.plan == nil {
		return nil, errors.New("请先生成整理预览")
	}
	return s.plan, nil
}

// Preview scans configured roots, merges cached deep-scan findings, and stores the plan.
func (s *Session) Preview(cfg config.Config) (domain.OrganizePlan, error) {
	base, err := scanner.Scan(cfg)
	if err != nil {
		return domain.OrganizePlan{}, err
	}
	s.mu.Lock()
	entries := mergeSkillEntries(base, s.extras)
	s.mu.Unlock()

	plan, err := BuildPlan(entries, cfg)
	if err != nil {
		return domain.OrganizePlan{}, err
	}
	s.mu.Lock()
	s.plan = &plan
	s.mu.Unlock()
	return plan, nil
}

// Update replaces the stored plan after validating paths against hub, tools, and extras.
func (s *Session) Update(plan domain.OrganizePlan, cfg config.Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := validateOrganizePlan(plan, cfg, s.extras); err != nil {
		return err
	}
	p := plan
	s.plan = &p
	return nil
}

// ApplyRound writes the current merge round for skillID and advances Side B.
func (s *Session) ApplyRound(skillID string, cfg config.Config) (domain.OrganizePlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan, err := s.requirePlanLocked()
	if err != nil {
		return domain.OrganizePlan{}, err
	}
	c, ok := findConflictPtr(plan, skillID)
	if !ok {
		return domain.OrganizePlan{}, fmt.Errorf("未找到技能 %s 的冲突", skillID)
	}
	if c.Total > 0 && c.Index >= c.Total && len(c.PendingSources) == 0 {
		return domain.OrganizePlan{}, fmt.Errorf("技能 %s 已是最后一轮合并，请直接执行整理", skillID)
	}
	hub, err := conflictHubPath(cfg.HubPath, skillID)
	if err != nil {
		return domain.OrganizePlan{}, err
	}
	if err := ApplyConflictRound(c, hub, trash.New(cfg.HubPath)); err != nil {
		return domain.OrganizePlan{}, err
	}
	return *plan, nil
}

// SkipSkillConflict marks a conflict skill as skipped.
func (s *Session) SkipSkillConflict(skillID string) (domain.OrganizePlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan, err := s.requirePlanLocked()
	if err != nil {
		return domain.OrganizePlan{}, err
	}
	c, ok := findConflictPtr(plan, skillID)
	if !ok {
		return domain.OrganizePlan{}, fmt.Errorf("未找到技能 %s 的冲突", skillID)
	}
	SkipConflict(c)
	return *plan, nil
}

// ResetSkillConflict clears skip flag and file resolutions for a conflict skill.
func (s *Session) ResetSkillConflict(skillID string) (domain.OrganizePlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan, err := s.requirePlanLocked()
	if err != nil {
		return domain.OrganizePlan{}, err
	}
	c, ok := findConflictPtr(plan, skillID)
	if !ok {
		return domain.OrganizePlan{}, fmt.Errorf("未找到技能 %s 的冲突", skillID)
	}
	ResetConflict(c)
	return *plan, nil
}

// ReadConflictFileTexts returns side-by-side text for a both_diff conflict file.
func (s *Session) ReadConflictFileTexts(skillID, rel string) (domain.ConflictFileTexts, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan, err := s.requirePlanLocked()
	if err != nil {
		return domain.ConflictFileTexts{}, err
	}
	c, ok := findConflictPtr(plan, skillID)
	if !ok {
		return domain.ConflictFileTexts{}, fmt.Errorf("未找到技能 %s 的冲突", skillID)
	}
	return ReadConflictSideTexts(*c, rel)
}

// SetConflictFileChoice sets keep_a / keep_b / manual for one conflict file.
func (s *Session) SetConflictFileChoice(skillID, rel, choice, merged string) (domain.OrganizePlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan, err := s.requirePlanLocked()
	if err != nil {
		return domain.OrganizePlan{}, err
	}
	c, ok := findConflictPtr(plan, skillID)
	if !ok {
		return domain.OrganizePlan{}, fmt.Errorf("未找到技能 %s 的冲突", skillID)
	}
	rel = filepath.ToSlash(rel)
	fc := domain.FileChoice(choice)
	switch fc {
	case domain.ChoiceKeepA, domain.ChoiceKeepB, domain.ChoiceManual, "":
		// "" clears the file resolution (e.g. merge hunks still unresolved).
	default:
		return domain.OrganizePlan{}, fmt.Errorf("无效的冲突选择: %s", choice)
	}
	for i := range c.Files {
		if c.Files[i].RelativePath == rel {
			c.Files[i].Choice = fc
			c.Files[i].MergedContent = merged
			return *plan, nil
		}
	}
	return domain.OrganizePlan{}, fmt.Errorf("未找到冲突文件: %s", rel)
}

// CheckExecute reports whether the stored plan may be executed.
func (s *Session) CheckExecute() (domain.CanExecuteResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan, err := s.requirePlanLocked()
	if err != nil {
		return domain.CanExecuteResult{}, err
	}
	ok, reason := CanExecute(*plan)
	return domain.CanExecuteResult{OK: ok, Reason: reason}, nil
}

// Run applies the stored plan and records suggested workdirs / drops succeeded extras.
func (s *Session) Run(cfg config.Config) (domain.OrganizeReport, error) {
	s.mu.Lock()
	plan, err := s.requirePlanLocked()
	if err != nil {
		s.mu.Unlock()
		return domain.OrganizeReport{}, err
	}
	snapshot := *plan
	s.mu.Unlock()

	report, err := Execute(snapshot, cfg, trash.New(cfg.HubPath))
	if err != nil {
		return report, err
	}
	s.mu.Lock()
	s.suggestedWorkdirs = report.SuggestedWorkdirs
	s.dropDeepExtrasLocked(report.Succeeded)
	s.mu.Unlock()
	return report, nil
}

// SuggestedWorkdirs is the allowlist from the last successful Execute.
func (s *Session) SuggestedWorkdirs() []domain.SuggestedWorkdir {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.suggestedWorkdirs) == 0 {
		return nil
	}
	out := make([]domain.SuggestedWorkdir, len(s.suggestedWorkdirs))
	copy(out, s.suggestedWorkdirs)
	return out
}

// DeepScan walks home for skills, caches findings for Preview, and returns unmanaged extras.
func (s *Session) DeepScan(home string, cfg config.Config, onProgress func(string)) ([]domain.SkillEntry, error) {
	s.deepMu.Lock()
	if s.deepCancel != nil {
		s.deepMu.Unlock()
		return nil, errors.New("深度扫描已在进行中")
	}
	cancel := make(chan struct{})
	s.deepCancel = cancel
	s.deepMu.Unlock()
	defer func() {
		s.deepMu.Lock()
		s.deepCancel = nil
		s.deepMu.Unlock()
	}()

	entries, err := scanner.DeepScan(home, cfg, cancel, onProgress)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.extras = entries
	s.mu.Unlock()

	base, err := scanner.Scan(cfg)
	if err != nil {
		return nil, err
	}
	return newDeepScanExtras(base, entries), nil
}

// CancelDeepScan requests cancellation of an in-progress DeepScan.
func (s *Session) CancelDeepScan() {
	s.deepMu.Lock()
	defer s.deepMu.Unlock()
	if s.deepCancel == nil {
		return
	}
	select {
	case <-s.deepCancel:
	default:
		close(s.deepCancel)
	}
}

// PreviewRestoreOrphans scans for hub-pointing symlinks outside tool roots and caches them.
func (s *Session) PreviewRestoreOrphans(home string, cfg config.Config, onProgress func(string)) ([]domain.RestoreOrphanItem, error) {
	items, err := FindRestorableOrphanLinks(home, cfg, onProgress)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.restoreOrphans = items
	s.mu.Unlock()
	return items, nil
}

// RestoreOrphans converts selected cached mistaken links back into real directories.
func (s *Session) RestoreOrphans(linkPaths []string, cfg config.Config) (domain.RestoreOrphanReport, error) {
	s.mu.Lock()
	if len(s.restoreOrphans) == 0 {
		s.mu.Unlock()
		return domain.RestoreOrphanReport{}, fmt.Errorf("无待恢复项，请先扫描误迁链接")
	}
	if len(linkPaths) == 0 {
		s.mu.Unlock()
		return domain.RestoreOrphanReport{}, nil
	}
	cached := append([]domain.RestoreOrphanItem(nil), s.restoreOrphans...)
	s.mu.Unlock()

	report, err := RestoreOrphanLinks(cached, linkPaths, cfg, trash.New(cfg.HubPath))
	if err != nil {
		return domain.RestoreOrphanReport{}, err
	}
	if len(report.Succeeded) > 0 {
		s.mu.Lock()
		s.pruneRestoredOrphansLocked(report.Succeeded)
		s.mu.Unlock()
	}
	return report, nil
}

func (s *Session) pruneRestoredOrphansLocked(succeeded []domain.ReportItem) {
	restoredLinks := make(map[string]struct{}, len(succeeded))
	for _, item := range succeeded {
		p, ok := cutRestoredOrphanLink(item.Message)
		if !ok {
			continue
		}
		restoredLinks[absCleanNoEval(p)] = struct{}{}
	}
	next := make([]domain.RestoreOrphanItem, 0, len(s.restoreOrphans))
	for _, it := range s.restoreOrphans {
		if _, ok := restoredLinks[absCleanNoEval(it.LinkPath)]; ok {
			continue
		}
		next = append(next, it)
	}
	s.restoreOrphans = next
}

func findConflictPtr(plan *domain.OrganizePlan, skillID string) (*domain.ConflictSkill, bool) {
	for i := range plan.Conflicts {
		if plan.Conflicts[i].SkillID == skillID {
			return &plan.Conflicts[i], true
		}
	}
	return nil, false
}

func conflictHubPath(hubRoot, skillID string) (string, error) {
	if found, ok := fsutil.FindHubSkillDir(hubRoot, skillID); ok {
		return found, nil
	}
	return hubSkillPath(hubRoot, skillID)
}
