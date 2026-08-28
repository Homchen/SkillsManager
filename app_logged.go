package main

import (
	"context"
	"unicode/utf8"

	"SkillsManager/internal/applog"
	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
)

// App is the Wails-bound facade: every user-facing method is logged.
type App struct {
	inner *appCore
}

func NewApp() *App {
	return &App{inner: newAppCore()}
}

func (a *App) startup(ctx context.Context) {
	a.inner.startup(ctx)
	a.inner.startTray()
}

func (a *App) shutdown(ctx context.Context) {
	a.inner.stopTray()
	a.inner.shutdown(ctx)
}

func (a *App) GetConfig() (config.Config, error) {
	return applog.OpValue("GetConfig", a.inner.GetConfig)
}

func (a *App) GetConfigLoadError() string {
	v, _ := applog.OpValue("GetConfigLoadError", func() (string, error) {
		return a.inner.GetConfigLoadError(), nil
	})
	return v
}

func (a *App) SetCollapsedSkillGroups(ids []string) error {
	return applog.Op("SetCollapsedSkillGroups", func() error {
		return a.inner.SetCollapsedSkillGroups(ids)
	}, "count", len(ids))
}

func (a *App) SetSkillsLayout(layout string) error {
	return applog.Op("SetSkillsLayout", func() error {
		return a.inner.SetSkillsLayout(layout)
	}, "layout", layout)
}

func (a *App) SaveConfig(cfg config.Config) error {
	return applog.Op("SaveConfig", func() error {
		return a.inner.SaveConfig(cfg)
	}, "logDebug", cfg.LogDebug)
}

func (a *App) SelectDirectory(title, defaultDir string) (string, error) {
	return applog.OpValue("SelectDirectory", func() (string, error) {
		return a.inner.SelectDirectory(title, defaultDir)
	}, "title", title)
}

func (a *App) OpenFolder(path string) error {
	return applog.Op("OpenFolder", func() error {
		return a.inner.OpenFolder(path)
	})
}

func (a *App) LogsDir() (string, error) {
	return applog.OpValue("LogsDir", a.inner.LogsDir)
}

func (a *App) OpenLogsFolder() error {
	return applog.Op("OpenLogsFolder", a.inner.OpenLogsFolder)
}

func (a *App) LogClientEvent(level, message, detail string) {
	a.inner.LogClientEvent(level, message, detail)
}

func (a *App) ExportToolSkills(toolID string) (domain.ExportToolSkillsResult, error) {
	return applog.OpValue("ExportToolSkills", func() (domain.ExportToolSkillsResult, error) {
		return a.inner.ExportToolSkills(toolID)
	}, "toolId", toolID)
}

func (a *App) RevealInFolder(path string) error {
	return applog.Op("RevealInFolder", func() error {
		return a.inner.RevealInFolder(path)
	})
}

func (a *App) ListSkills() ([]domain.SkillEntry, error) {
	return applog.OpValue("ListSkills", a.inner.ListSkills)
}

func (a *App) GetSkillUsageSummary() (domain.SkillUsageSummary, error) {
	return applog.OpValue("GetSkillUsageSummary", a.inner.GetSkillUsageSummary)
}

func (a *App) DeepScanSkills() ([]domain.SkillEntry, error) {
	return applog.OpValue("DeepScanSkills", a.inner.DeepScanSkills)
}

func (a *App) CancelDeepScan() {
	_ = applog.Op("CancelDeepScan", func() error {
		a.inner.CancelDeepScan()
		return nil
	})
}

func (a *App) CreateSkill(id, name, group, language string) error {
	return applog.Op("CreateSkill", func() error {
		return a.inner.CreateSkill(id, name, group, language)
	}, "skillId", id, "group", group, "language", language)
}

func (a *App) ImportSkills(paths []string) (domain.ImportSkillsResult, error) {
	return applog.OpValue("ImportSkills", func() (domain.ImportSkillsResult, error) {
		return a.inner.ImportSkills(paths)
	}, "count", len(paths))
}

func (a *App) ListGroups() ([]domain.GroupInfo, error) {
	return applog.OpValue("ListGroups", a.inner.ListGroups)
}

func (a *App) CreateGroup(name string) error {
	return applog.Op("CreateGroup", func() error {
		return a.inner.CreateGroup(name)
	}, "group", name)
}

func (a *App) RenameGroup(oldName, newName string) error {
	return applog.Op("RenameGroup", func() error {
		return a.inner.RenameGroup(oldName, newName)
	}, "from", oldName, "to", newName)
}

func (a *App) DeleteGroup(name string) error {
	return applog.Op("DeleteGroup", func() error {
		return a.inner.DeleteGroup(name)
	}, "group", name)
}

func (a *App) SetSkillGroup(skillID, group string) error {
	return applog.Op("SetSkillGroup", func() error {
		return a.inner.SetSkillGroup(skillID, group)
	}, "skillId", skillID, "group", group)
}

func (a *App) RenameSkill(oldID, newID string) error {
	return applog.Op("RenameSkill", func() error {
		return a.inner.RenameSkill(oldID, newID)
	}, "from", oldID, "to", newID)
}

func (a *App) DeleteSkill(id string) error {
	return applog.Op("DeleteSkill", func() error {
		return a.inner.DeleteSkill(id)
	}, "skillId", id)
}

func (a *App) ListTrash() ([]domain.TrashItem, error) {
	return applog.OpValue("ListTrash", a.inner.ListTrash)
}

func (a *App) RestoreTrash(trashPath string, overwrite bool) error {
	return applog.Op("RestoreTrash", func() error {
		return a.inner.RestoreTrash(trashPath, overwrite)
	}, "overwrite", overwrite)
}

func (a *App) PurgeTrash(trashPath string) error {
	return applog.Op("PurgeTrash", func() error {
		return a.inner.PurgeTrash(trashPath)
	})
}

func (a *App) ListSkillFiles(ref domain.SkillVersionRef) ([]string, error) {
	return applog.OpValue("ListSkillFiles", func() ([]string, error) {
		return a.inner.ListSkillFiles(ref)
	}, "skillId", ref.ID, "language", ref.Language)
}

func (a *App) ReadSkillFile(ref domain.SkillVersionRef, rel string) (string, error) {
	return applog.OpValue("ReadSkillFile", func() (string, error) {
		return a.inner.ReadSkillFile(ref, rel)
	}, "skillId", ref.ID, "file", rel)
}

func (a *App) WriteSkillFile(ref domain.SkillVersionRef, rel, content string) error {
	return applog.Op("WriteSkillFile", func() error {
		return a.inner.WriteSkillFile(ref, rel, content)
	}, "skillId", ref.ID, "file", rel, "chars", utf8.RuneCountInString(content))
}

func (a *App) CreateSkillFile(ref domain.SkillVersionRef, rel string) error {
	return applog.Op("CreateSkillFile", func() error {
		return a.inner.CreateSkillFile(ref, rel)
	}, "skillId", ref.ID, "file", rel)
}

func (a *App) RenameSkillEntry(ref domain.SkillVersionRef, oldRel, newRel string) error {
	return applog.Op("RenameSkillEntry", func() error {
		return a.inner.RenameSkillEntry(ref, oldRel, newRel)
	}, "skillId", ref.ID, "from", oldRel, "to", newRel)
}

func (a *App) DeleteSkillEntry(ref domain.SkillVersionRef, rel string) error {
	return applog.Op("DeleteSkillEntry", func() error {
		return a.inner.DeleteSkillEntry(ref, rel)
	}, "skillId", ref.ID, "file", rel)
}

func (a *App) CreateSkillDir(ref domain.SkillVersionRef, rel string) error {
	return applog.Op("CreateSkillDir", func() error {
		return a.inner.CreateSkillDir(ref, rel)
	}, "skillId", ref.ID, "dir", rel)
}

func (a *App) GetSkillI18n(id string) (domain.SkillI18nInfo, error) {
	return applog.OpValue("GetSkillI18n", func() (domain.SkillI18nInfo, error) {
		return a.inner.GetSkillI18n(id)
	}, "skillId", id)
}

func (a *App) SetSkillOriginalLanguage(id, language string) error {
	return applog.Op("SetSkillOriginalLanguage", func() error {
		return a.inner.SetSkillOriginalLanguage(id, language)
	}, "skillId", id, "language", language)
}

func (a *App) RetagSkillDefaultLanguage(id, language string) error {
	return applog.Op("RetagSkillDefaultLanguage", func() error {
		return a.inner.RetagSkillDefaultLanguage(id, language)
	}, "skillId", id, "language", language)
}

func (a *App) SetSkillDefaultLanguage(id, language string) error {
	return applog.Op("SetSkillDefaultLanguage", func() error {
		return a.inner.SetSkillDefaultLanguage(id, language)
	}, "skillId", id, "language", language)
}

func (a *App) DeleteSkillLanguage(id, language string) error {
	return applog.Op("DeleteSkillLanguage", func() error {
		return a.inner.DeleteSkillLanguage(id, language)
	}, "skillId", id, "language", language)
}

func (a *App) TranslateSkillDescription(description string) (string, error) {
	return applog.OpValue("TranslateSkillDescription", func() (string, error) {
		return a.inner.TranslateSkillDescription(description)
	}, "chars", utf8.RuneCountInString(description))
}

func (a *App) StartSkillTranslation(sourceID string) (string, error) {
	return applog.OpValue("StartSkillTranslation", func() (string, error) {
		return a.inner.StartSkillTranslation(sourceID)
	}, "skillId", sourceID)
}

func (a *App) CancelSkillTranslation() {
	_ = applog.Op("CancelSkillTranslation", func() error {
		a.inner.CancelSkillTranslation()
		return nil
	})
}

func (a *App) SetSkillLink(skillID, toolID string, enabled bool) error {
	return applog.Op("SetSkillLink", func() error {
		return a.inner.SetSkillLink(skillID, toolID, enabled)
	}, "skillId", skillID, "toolId", toolID, "enabled", enabled)
}

func (a *App) GetLinkSnapshot(toolID string) (*config.LinkSnapshot, error) {
	return applog.OpValue("GetLinkSnapshot", func() (*config.LinkSnapshot, error) {
		return a.inner.GetLinkSnapshot(toolID)
	}, "toolId", toolID)
}

func (a *App) DisableAllSkillLinks(toolIDs []string) (domain.BulkLinkResult, error) {
	return applog.OpValue("DisableAllSkillLinks", func() (domain.BulkLinkResult, error) {
		return a.inner.DisableAllSkillLinks(toolIDs)
	}, "tools", len(toolIDs))
}

func (a *App) EnableSkillLinks(toolIDs []string, mode string) (domain.BulkLinkResult, error) {
	return applog.OpValue("EnableSkillLinks", func() (domain.BulkLinkResult, error) {
		return a.inner.EnableSkillLinks(toolIDs, mode)
	}, "tools", len(toolIDs), "mode", mode)
}

func (a *App) PreviewOrganize() (domain.OrganizePlan, error) {
	return applog.OpValue("PreviewOrganize", a.inner.PreviewOrganize)
}

func (a *App) UpdateOrganizePlan(plan domain.OrganizePlan) error {
	return applog.Op("UpdateOrganizePlan", func() error {
		return a.inner.UpdateOrganizePlan(plan)
	}, "actions", len(plan.Actions))
}

func (a *App) ApplyConflictRound(skillID string) (domain.OrganizePlan, error) {
	return applog.OpValue("ApplyConflictRound", func() (domain.OrganizePlan, error) {
		return a.inner.ApplyConflictRound(skillID)
	}, "skillId", skillID)
}

func (a *App) SkipConflict(skillID string) (domain.OrganizePlan, error) {
	return applog.OpValue("SkipConflict", func() (domain.OrganizePlan, error) {
		return a.inner.SkipConflict(skillID)
	}, "skillId", skillID)
}

func (a *App) ResetConflict(skillID string) (domain.OrganizePlan, error) {
	return applog.OpValue("ResetConflict", func() (domain.OrganizePlan, error) {
		return a.inner.ResetConflict(skillID)
	}, "skillId", skillID)
}

func (a *App) ReadConflictFileTexts(skillID, rel string) (domain.ConflictFileTexts, error) {
	return applog.OpValue("ReadConflictFileTexts", func() (domain.ConflictFileTexts, error) {
		return a.inner.ReadConflictFileTexts(skillID, rel)
	}, "skillId", skillID, "file", rel)
}

func (a *App) SetConflictFileChoice(skillID, rel, choice, merged string) (domain.OrganizePlan, error) {
	return applog.OpValue("SetConflictFileChoice", func() (domain.OrganizePlan, error) {
		return a.inner.SetConflictFileChoice(skillID, rel, choice, merged)
	}, "skillId", skillID, "file", rel, "choice", choice)
}

func (a *App) CanExecuteOrganize() (domain.CanExecuteResult, error) {
	return applog.OpValue("CanExecuteOrganize", a.inner.CanExecuteOrganize)
}

func (a *App) ExecuteOrganize() (domain.OrganizeReport, error) {
	return applog.OpValue("ExecuteOrganize", a.inner.ExecuteOrganize)
}

func (a *App) ConfirmAddWorkdirs(paths []string) (domain.AddWorkdirsResult, error) {
	return applog.OpValue("ConfirmAddWorkdirs", func() (domain.AddWorkdirsResult, error) {
		return a.inner.ConfirmAddWorkdirs(paths)
	}, "count", len(paths))
}

func (a *App) PreviewRestoreOrphanLinks() ([]domain.RestoreOrphanItem, error) {
	return applog.OpValue("PreviewRestoreOrphanLinks", a.inner.PreviewRestoreOrphanLinks)
}

func (a *App) RestoreOrphanLinks(linkPaths []string) (domain.RestoreOrphanReport, error) {
	return applog.OpValue("RestoreOrphanLinks", func() (domain.RestoreOrphanReport, error) {
		return a.inner.RestoreOrphanLinks(linkPaths)
	}, "count", len(linkPaths))
}

func (a *App) IsElevated() bool {
	v, _ := applog.OpValue("IsElevated", func() (bool, error) {
		return a.inner.IsElevated(), nil
	})
	return v
}

func (a *App) RequestElevation() error {
	return applog.Op("RequestElevation", a.inner.RequestElevation)
}
