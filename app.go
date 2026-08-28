package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"SkillsManager/internal/applog"
	"SkillsManager/internal/bulklink"
	"SkillsManager/internal/config"
	"SkillsManager/internal/domain"
	skellexport "SkillsManager/internal/export"
	"SkillsManager/internal/fsutil"
	"SkillsManager/internal/hubmigrate"
	"SkillsManager/internal/linker"
	"SkillsManager/internal/organizer"
	"SkillsManager/internal/priv"
	"SkillsManager/internal/scanner"
	"SkillsManager/internal/skilli18n"
	skillimport "SkillsManager/internal/skillimport"
	"SkillsManager/internal/skillrepo"
	"SkillsManager/internal/skilltranslate"
	"SkillsManager/internal/skillusage"
	"SkillsManager/internal/translator"
	"SkillsManager/internal/trash"
	"SkillsManager/internal/workdir"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const errNeedAdmin = "需要管理员权限才能创建符号链接，请在设置中点击「以管理员身份重启」"

const eventDeepScanProgress = "deepscan:progress"
const eventRestoreOrphanProgress = "restoreorphan:progress"
const eventSkillTranslationProgress = "skilltranslation:progress"

// appCore holds application state. Wails binds the logging facade App.
type appCore struct {
	ctx          context.Context
	cfg          config.Config
	settingsPath string
	organize     *organizer.Session

	skillTranslationMu         sync.Mutex
	skillTranslationCancel     context.CancelFunc
	skillTranslationActive     bool
	skillTranslationUserCancel bool

	configLoadError string

	// trayStarted is set when the system tray loop is launched.
	trayStarted atomic.Bool

	// elevatedFn, when set, overrides priv.IsElevated (tests only).
	elevatedFn func() bool
}

func newAppCore() *appCore {
	return &appCore{organize: organizer.NewSession()}
}

func (a *appCore) session() *organizer.Session {
	if a.organize == nil {
		a.organize = organizer.NewSession()
	}
	return a.organize
}

// startup is called when the app starts.
func (a *appCore) startup(ctx context.Context) {
	a.ctx = ctx
	if dir, err := applog.DefaultDir(); err == nil {
		_ = applog.Init(dir, false)
	}

	path, err := config.DefaultSettingsPath()
	if err != nil {
		a.cfg = config.Default()
		a.configLoadError = "无法定位配置文件，已使用默认设置: " + err.Error()
		applog.Error("startup failed", "err", err)
		a.ensureHubReady()
		a.applyLogging()
		return
	}
	a.settingsPath = path
	cfg, err := config.Load(path)
	if err != nil {
		bak := path + ".corrupt"
		if renameErr := os.Rename(path, bak); renameErr == nil {
			recovered, _ := config.RecoverCorruptSettings(path)
			a.cfg = recovered
			a.configLoadError = "配置文件损坏，已备份为 settings.json.corrupt 并使用默认设置"
		} else {
			a.cfg = config.Default()
			_ = a.cfg.HydrateSecrets()
			a.configLoadError = "无法读取配置文件，已使用默认设置: " + err.Error()
		}
		applog.Error("config load failed", "err", err)
		a.ensureHubReady()
		a.applyLogging()
		return
	}
	a.cfg = cfg
	a.ensureHubReady()
	a.applyLogging()
	applog.Info("app start", "elevated", priv.IsElevated(), "logDebug", a.cfg.LogDebug)
}

func (a *appCore) shutdown(ctx context.Context) {
	applog.Info("app stop")
	applog.Close()
}

func (a *appCore) applyLogging() {
	applog.SetDebug(a.cfg.LogDebug)
	applog.SetSecrets(a.cfg.OpenAIAPIKey, a.cfg.MicrosoftTranslatorKey)
}

func (a *appCore) ensureHubReady() {
	a.cfg.NormalizeTools()
	_ = config.EnsureHubDir(a.cfg.HubPath)
	a.purgeTrash()
}

func (a *appCore) isElevated() bool {
	if a.elevatedFn != nil {
		return a.elevatedFn()
	}
	return priv.IsElevated()
}

func (a *appCore) requireElevated() error {
	if !a.isElevated() {
		return errors.New(errNeedAdmin)
	}
	return nil
}

func (a *appCore) repo() *skillrepo.Repo {
	return skillrepo.New(a.cfg.HubPath, trash.New(a.cfg.HubPath))
}

func (a *appCore) i18n() *skilli18n.Store {
	return skilli18n.New(a.cfg.HubPath)
}

func (a *appCore) enrichSkillI18n(entries []domain.SkillEntry) {
	store := a.i18n()
	for i := range entries {
		info, err := store.Info(entries[i].ID)
		if err != nil {
			continue
		}
		entries[i].DefaultLanguage = info.DefaultLanguage
		entries[i].TranslationCount = info.TranslationCount
	}
}

func (a *appCore) resolveSkillRoot(id, language string) (string, error) {
	_, hubPath, err := a.repo().Find(id)
	if err != nil {
		return "", err
	}
	return a.i18n().ResolveRoot(id, language, hubPath)
}

// GetConfig returns the current in-memory settings.
func (a *appCore) GetConfig() (config.Config, error) {
	a.cfg.NormalizeTools()
	return a.cfg, nil
}

// GetConfigLoadError returns a user-visible warning if settings.json could not be loaded.
func (a *appCore) GetConfigLoadError() string {
	return a.configLoadError
}

func (a *appCore) persistSettings() error {
	path := a.settingsPath
	if path == "" {
		p, err := config.DefaultSettingsPath()
		if err != nil {
			return err
		}
		path = p
		a.settingsPath = p
	}
	return a.cfg.Save(path)
}

// SetCollapsedSkillGroups updates only the collapsed-group list without rewriting other settings.
func (a *appCore) SetCollapsedSkillGroups(ids []string) error {
	a.cfg.CollapsedSkillGroups = append([]string(nil), ids...)
	return userErr(a.persistSettings())
}

// SetSkillsLayout updates only the skills page layout without rewriting other settings.
func (a *appCore) SetSkillsLayout(layout string) error {
	layout = strings.TrimSpace(layout)
	if layout != "flat" && layout != "grouped" {
		return fmt.Errorf("无效的布局: %s", layout)
	}
	a.cfg.SkillsLayout = layout
	return userErr(a.persistSettings())
}

// SaveConfig persists settings and updates the in-memory config.
func (a *appCore) SaveConfig(cfg config.Config) error {
	cfg.NormalizeTools()
	cfg.OpenAITemperature = config.NormalizeOpenAITemperature(cfg.OpenAITemperature)

	oldHub := strings.TrimSpace(a.cfg.HubPath)
	newHub := strings.TrimSpace(cfg.HubPath)
	hubChanged := oldHub != "" && newHub != "" && !hubPathsEqual(oldHub, newHub)

	if hubChanged {
		toolRoots := make([]string, 0, len(cfg.Tools)+len(a.cfg.Tools))
		for _, t := range cfg.Tools {
			if p := strings.TrimSpace(t.Path); p != "" {
				toolRoots = append(toolRoots, p)
			}
		}
		for _, t := range a.cfg.Tools {
			if p := strings.TrimSpace(t.Path); p != "" {
				toolRoots = append(toolRoots, p)
			}
		}
		if hubmigrate.NeedsContentMigrate(oldHub) {
			if err := a.requireElevated(); err != nil {
				return userErr(fmt.Errorf("迁移源仓需要管理员权限: %w", err))
			}
		}
		if err := hubmigrate.Migrate(oldHub, newHub, toolRoots); err != nil {
			return userErr(fmt.Errorf("迁移源仓失败: %w", err))
		}
		if err := skilli18n.MigrateRoot(oldHub, newHub); err != nil {
			return userErr(fmt.Errorf("迁移翻译仓失败: %w", err))
		}
	}

	if lang := strings.TrimSpace(cfg.TranslationTargetLanguage); lang != "" {
		if err := skilli18n.ValidateLanguage(lang); err != nil {
			return userErr(err)
		}
	}

	if err := config.EnsureHubDir(cfg.HubPath); err != nil {
		return userErr(fmt.Errorf("创建源仓目录失败: %w", err))
	}
	path := a.settingsPath
	if path == "" {
		p, err := config.DefaultSettingsPath()
		if err != nil {
			return userErr(err)
		}
		path = p
		a.settingsPath = p
	}
	if err := cfg.Save(path); err != nil {
		if hubChanged {
			a.cfg = cfg
		}
		return userErr(fmt.Errorf("内容可能已迁移但保存配置失败，请再次保存设置: %w", err))
	}
	if err := cfg.HydrateSecrets(); err != nil {
		return userErr(fmt.Errorf("内容可能已迁移但保存配置失败，请再次保存设置: %w", err))
	}
	a.cfg = cfg
	a.applyLogging()
	return nil
}

func hubPathsEqual(a, b string) bool {
	a = filepath.Clean(strings.TrimSpace(a))
	b = filepath.Clean(strings.TrimSpace(b))
	if goruntime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// SelectDirectory opens a native folder picker. Returns empty string if cancelled.
// When defaultDir is empty or invalid, the dialog starts in the user home directory.
func (a *appCore) SelectDirectory(title, defaultDir string) (string, error) {
	if a.ctx == nil {
		return "", errors.New("应用尚未初始化")
	}
	start := strings.TrimSpace(defaultDir)
	if start != "" {
		if st, err := os.Stat(start); err != nil || !st.IsDir() {
			parent := filepath.Dir(start)
			if st, err := os.Stat(parent); err == nil && st.IsDir() {
				start = parent
			} else {
				start = ""
			}
		}
	}
	if start == "" {
		if home, err := os.UserHomeDir(); err == nil {
			start = home
		}
	}
	if title == "" {
		title = "选择文件夹"
	}
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                title,
		DefaultDirectory:     start,
		CanCreateDirectories: true,
	})
	return dir, userErr(err)
}

// OpenFolder opens path in the system file manager.
// If path does not exist, opens the nearest existing parent directory.
func (a *appCore) OpenFolder(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return errors.New("路径为空")
	}
	path = os.ExpandEnv(path)
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	openPath := nearestExistingDir(abs)
	if openPath == "" {
		return userErr(fmt.Errorf("无法打开文件夹: 路径不存在且无可用父目录: %s", abs))
	}
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", openPath)
	case "darwin":
		cmd = exec.Command("open", openPath)
	default:
		cmd = exec.Command("xdg-open", openPath)
	}
	if err := cmd.Start(); err != nil {
		return userErr(fmt.Errorf("打开文件夹失败: %w", err))
	}
	return nil
}

// LogsDir returns the diagnostic log directory.
func (a *appCore) LogsDir() (string, error) {
	if d := applog.Dir(); d != "" {
		return d, nil
	}
	return applog.DefaultDir()
}

// OpenLogsFolder opens the diagnostic log directory in the system file manager.
func (a *appCore) OpenLogsFolder() error {
	dir, err := a.LogsDir()
	if err != nil {
		return userErr(err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return userErr(err)
	}
	return a.OpenFolder(dir)
}

// LogClientEvent records a frontend failure that never reached a Go method.
func (a *appCore) LogClientEvent(level, message, detail string) {
	args := []any{"module", "ui"}
	if d := strings.TrimSpace(detail); d != "" {
		args = append(args, "detail", d)
	}
	msg := strings.TrimSpace(message)
	if msg == "" {
		msg = "ui event"
	}
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "error":
		applog.Error(msg, args...)
	case "info":
		applog.Info(msg, args...)
	default:
		applog.Warn(msg, args...)
	}
}

// nearestExistingDir returns path if it is an existing directory, the parent of an
// existing file, or the nearest existing ancestor directory. Empty if none.
func nearestExistingDir(path string) string {
	p := filepath.Clean(path)
	for {
		st, err := os.Stat(p)
		if err == nil {
			if st.IsDir() {
				return p
			}
			return filepath.Dir(p)
		}
		parent := filepath.Dir(p)
		if parent == p {
			return ""
		}
		p = parent
	}
}

// ExportToolSkills zips hub sources for skills enabled (symlink/real_copy) under toolID.
func (a *appCore) ExportToolSkills(toolID string) (domain.ExportToolSkillsResult, error) {
	toolID = strings.TrimSpace(toolID)
	tool, ok := findTool(a.cfg, toolID)
	if !ok {
		return domain.ExportToolSkillsResult{}, userErr(fmt.Errorf("未找到工具: %s", toolID))
	}
	if strings.TrimSpace(tool.Path) == "" {
		return domain.ExportToolSkillsResult{}, userErr(fmt.Errorf("工具「%s」路径为空", toolID))
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return domain.ExportToolSkillsResult{}, userErr(err)
	}
	exportDir := filepath.Join(home, ".skillsmanager", "export")
	entries, err := a.listMerged()
	if err != nil {
		return domain.ExportToolSkillsResult{}, userErr(err)
	}
	res, err := skellexport.Export(a.cfg.HubPath, exportDir, toolID, entries, time.Now())
	return res, userErr(err)
}

// RevealInFolder opens the file manager and selects path when supported.
func (a *appCore) RevealInFolder(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return errors.New("路径为空")
	}
	path = os.ExpandEnv(path)
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	if _, err := os.Stat(abs); err != nil {
		return userErr(fmt.Errorf("无法定位文件: %w", err))
	}
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", "/select,"+abs)
	case "darwin":
		cmd = exec.Command("open", "-R", abs)
	default:
		cmd = exec.Command("xdg-open", filepath.Dir(abs))
	}
	if err := cmd.Start(); err != nil {
		return userErr(fmt.Errorf("打开所在位置失败: %w", err))
	}
	return nil
}

// ListSkills scans configured roots (hub + enabled tools). Deep-scan orphans are not included.
func (a *appCore) ListSkills() ([]domain.SkillEntry, error) {
	a.ensureHubReady()
	if err := migrateRootSkillsAndRelink(a.cfg, a.repo(), a.isElevated()); err != nil {
		if !isNeedAdminErr(err) {
			return nil, userErr(err)
		}
		applog.Info("list skills: skip linked root migrate, needs elevation", "err", err)
	}
	entries, err := a.listMerged()
	if err != nil {
		return entries, userErr(err)
	}
	a.enrichSkillI18n(entries)
	return entries, nil
}

// GetSkillUsageSummary returns usage stats for currently managed skills only.
func (a *appCore) GetSkillUsageSummary() (domain.SkillUsageSummary, error) {
	a.ensureHubReady()
	entries, err := a.listMerged()
	if err != nil {
		return domain.SkillUsageSummary{}, userErr(err)
	}
	summary, err := skillusage.LoadSummary(entries, a.cfg.HubPath)
	if err != nil {
		return domain.SkillUsageSummary{}, userErr(err)
	}
	return summary, nil
}

// DeepScanSkills walks the user home directory for orphan skills and caches them for organize preview.
// Progress is emitted on event "deepscan:progress"; call CancelDeepScan to abort.
// Returns only skills not already present in hub/configured tools (does not pollute ListSkills).
func (a *appCore) DeepScanSkills() ([]domain.SkillEntry, error) {
	jobID := applog.NewJobID("scan")
	applog.Info("deep scan start", "jobId", jobID)
	home, err := os.UserHomeDir()
	if err != nil {
		applog.Error("deep scan fail", "jobId", jobID, "err", err)
		return nil, userErr(err)
	}
	extras, err := a.session().DeepScan(home, a.cfg, func(p string) {
		applog.Debug("deep scan path", "jobId", jobID, "path", p)
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, eventDeepScanProgress, p)
		}
	})
	if err != nil {
		applog.Error("deep scan fail", "jobId", jobID, "err", err)
		return nil, userErr(err)
	}
	a.enrichSkillI18n(extras)
	applog.Info("deep scan ok", "jobId", jobID, "count", len(extras))
	return extras, nil
}

// CancelDeepScan requests cancellation of an in-progress deep scan.
func (a *appCore) CancelDeepScan() {
	a.session().CancelDeepScan()
}

// CreateSkill creates a new skill template in the hub under the given group.
// language is required and becomes the default language version.
func (a *appCore) CreateSkill(id, name, group, language string) error {
	if err := skilli18n.ValidateLanguage(language); err != nil {
		return userErr(err)
	}
	if err := a.repo().Create(id, name, group); err != nil {
		return userErr(err)
	}
	if err := a.i18n().InitDefault(id, language); err != nil {
		_ = a.repo().Delete(id)
		return userErr(err)
	}
	return nil
}

// ImportSkills copies dropped skill folders / export zips / .skill packages into the hub default group.
func (a *appCore) ImportSkills(paths []string) (domain.ImportSkillsResult, error) {
	a.ensureHubReady()
	res, err := skillimport.Import(a.cfg.HubPath, paths)
	if res.Items == nil {
		res.Items = []domain.ImportSkillItem{}
	}
	return res, userErr(err)
}

// ListGroups returns first-level hub groups (including default and empty groups).
func (a *appCore) ListGroups() ([]domain.GroupInfo, error) {
	a.ensureHubReady()
	groups, err := a.repo().ListGroups()
	if groups == nil {
		groups = []domain.GroupInfo{}
	}
	return groups, userErr(err)
}

// CreateGroup creates an empty custom group directory under the hub.
func (a *appCore) CreateGroup(name string) error {
	a.ensureHubReady()
	return userErr(a.repo().CreateGroup(name))
}

// RenameGroup renames a custom group and retargets tool symlinks for skills inside it.
func (a *appCore) RenameGroup(oldName, newName string) error {
	a.ensureHubReady()
	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)
	if oldName == newName {
		return nil
	}
	if anyGroupSkillHasToolLinks(a.cfg, a.cfg.HubPath, oldName) {
		if err := a.requireElevated(); err != nil {
			return err
		}
	}
	if err := a.repo().RenameGroup(oldName, newName); err != nil {
		return userErr(err)
	}
	a.cfg.RenameCollapsedSkillGroup(oldName, newName)
	if err := a.persistSettings(); err != nil {
		return userErr(err)
	}
	ids, err := listGroupSkillIDs(a.cfg.HubPath, newName)
	if err != nil {
		return userErr(err)
	}
	elevated := priv.IsElevated()
	for _, id := range ids {
		path, err := a.resolveHubSkillPath(id)
		if err != nil {
			return userErr(err)
		}
		if err := relinkSkillHubTarget(a.cfg, id, path, elevated); err != nil {
			return userErr(err)
		}
	}
	return nil
}

// DeleteGroup moves skills into default, retargets tool links, then removes the empty group.
func (a *appCore) DeleteGroup(name string) error {
	a.ensureHubReady()
	name = strings.TrimSpace(name)
	ids, err := listGroupSkillIDs(a.cfg.HubPath, name)
	if err != nil {
		return userErr(err)
	}
	if anyGroupSkillHasToolLinks(a.cfg, a.cfg.HubPath, name) {
		if err := a.requireElevated(); err != nil {
			return err
		}
	}
	if err := a.repo().DeleteGroup(name); err != nil {
		return userErr(err)
	}
	a.cfg.RemoveCollapsedSkillGroup(name)
	if err := a.persistSettings(); err != nil {
		return userErr(err)
	}
	elevated := priv.IsElevated()
	for _, id := range ids {
		path, err := a.resolveHubSkillPath(id)
		if err != nil {
			return userErr(err)
		}
		if err := relinkSkillHubTarget(a.cfg, id, path, elevated); err != nil {
			return userErr(err)
		}
	}
	return nil
}

// SetSkillGroup moves a hub skill into another group and retargets tool symlinks.
func (a *appCore) SetSkillGroup(skillID, group string) error {
	curGroup, _, err := a.repo().Find(skillID)
	if err != nil {
		return userErr(err)
	}
	target := strings.TrimSpace(group)
	if target == "" {
		target = domain.DefaultGroup
	}
	if curGroup == target {
		return nil
	}
	if skillHasToolLinks(a.cfg, skillID) {
		if err := a.requireElevated(); err != nil {
			return err
		}
	}
	if err := a.repo().SetSkillGroup(skillID, group); err != nil {
		return userErr(err)
	}
	path, err := a.resolveHubSkillPath(skillID)
	if err != nil {
		return userErr(err)
	}
	return userErr(relinkSkillHubTarget(a.cfg, skillID, path, priv.IsElevated()))
}

// RenameSkill renames a skill directory under the hub and updates tool symlinks when elevated.
func (a *appCore) RenameSkill(oldID, newID string) error {
	if skillHasToolLinks(a.cfg, oldID) {
		if err := a.requireElevated(); err != nil {
			return err
		}
	}
	if err := a.repo().Rename(oldID, newID); err != nil {
		return userErr(err)
	}
	if err := a.i18n().Rename(oldID, newID); err != nil {
		return userErr(err)
	}
	path, err := a.resolveHubSkillPath(newID)
	if err != nil {
		return userErr(err)
	}
	return userErr(relinkSkillAfterRename(a.cfg, oldID, newID, path, priv.IsElevated()))
}

// DeleteSkill removes related tool symlinks then moves the hub skill into trash.
// All translation versions under skills_translation are permanently removed.
func (a *appCore) DeleteSkill(id string) error {
	if err := unlinkSkillToolLinks(a.cfg, id); err != nil {
		return userErr(err)
	}
	if err := a.repo().Delete(id); err != nil {
		return userErr(err)
	}
	if err := a.i18n().RemoveAll(id); err != nil {
		a.purgeTrash()
		return userErr(fmt.Errorf("已移入回收站，但删除翻译版本失败: %w", err))
	}
	a.purgeTrash()
	return nil
}

// ListTrash returns skills currently in the hub trash.
func (a *appCore) ListTrash() ([]domain.TrashItem, error) {
	items, err := trash.New(a.cfg.HubPath).List(a.cfg.TrashRetentionDays)
	if err != nil {
		return nil, userErr(err)
	}
	if items == nil {
		items = []domain.TrashItem{}
	}
	return items, nil
}

// RestoreTrash moves a trash entry back to the hub. overwrite replaces an existing hub skill
// by moving it into trash first. Does not recreate tool symlinks.
func (a *appCore) RestoreTrash(trashPath string, overwrite bool) error {
	return userErr(trash.New(a.cfg.HubPath).Restore(trashPath, overwrite))
}

// PurgeTrash permanently deletes one trash entry.
func (a *appCore) PurgeTrash(trashPath string) error {
	return userErr(trash.New(a.cfg.HubPath).PurgeEntry(trashPath))
}

// ListSkillFiles lists relative file paths under a skill language version.
// Empty language resolves to the current default (hub) version.
func (a *appCore) ListSkillFiles(ref domain.SkillVersionRef) ([]string, error) {
	root, err := a.resolveSkillRoot(ref.ID, ref.Language)
	if err != nil {
		return nil, userErr(err)
	}
	files, err := skillrepo.ListFilesIn(root)
	return files, userErr(err)
}

// ReadSkillFile reads a text file under a skill language version.
func (a *appCore) ReadSkillFile(ref domain.SkillVersionRef, rel string) (string, error) {
	root, err := a.resolveSkillRoot(ref.ID, ref.Language)
	if err != nil {
		return "", userErr(err)
	}
	content, err := skillrepo.ReadFileIn(root, rel)
	return content, userErr(err)
}

// WriteSkillFile writes a text file under a skill language version.
func (a *appCore) WriteSkillFile(ref domain.SkillVersionRef, rel, content string) error {
	root, err := a.resolveSkillRoot(ref.ID, ref.Language)
	if err != nil {
		return userErr(err)
	}
	return userErr(skillrepo.WriteFileIn(root, rel, content))
}

// CreateSkillFile creates an empty text file under a skill language version.
func (a *appCore) CreateSkillFile(ref domain.SkillVersionRef, rel string) error {
	root, err := a.resolveSkillRoot(ref.ID, ref.Language)
	if err != nil {
		return userErr(err)
	}
	return userErr(skillrepo.CreateFileIn(root, rel))
}

// RenameSkillEntry renames a file or directory under a skill language version.
func (a *appCore) RenameSkillEntry(ref domain.SkillVersionRef, oldRel, newRel string) error {
	root, err := a.resolveSkillRoot(ref.ID, ref.Language)
	if err != nil {
		return userErr(err)
	}
	return userErr(skillrepo.RenameEntryIn(root, oldRel, newRel))
}

// DeleteSkillEntry permanently removes a file or directory under a skill language version.
func (a *appCore) DeleteSkillEntry(ref domain.SkillVersionRef, rel string) error {
	root, err := a.resolveSkillRoot(ref.ID, ref.Language)
	if err != nil {
		return userErr(err)
	}
	return userErr(skillrepo.DeleteEntryIn(root, rel))
}

// CreateSkillDir creates a directory under a skill language version.
func (a *appCore) CreateSkillDir(ref domain.SkillVersionRef, rel string) error {
	root, err := a.resolveSkillRoot(ref.ID, ref.Language)
	if err != nil {
		return userErr(err)
	}
	return userErr(skillrepo.MkdirIn(root, rel))
}

// GetSkillI18n returns language-version metadata for a skill.
func (a *appCore) GetSkillI18n(id string) (domain.SkillI18nInfo, error) {
	if _, _, err := a.repo().Find(id); err != nil {
		return domain.SkillI18nInfo{}, userErr(err)
	}
	info, err := a.i18n().Info(id)
	if err != nil {
		return domain.SkillI18nInfo{}, userErr(err)
	}
	return domain.SkillI18nInfo{
		DefaultLanguage:  info.DefaultLanguage,
		Languages:        info.Languages,
		TranslationCount: info.TranslationCount,
	}, nil
}

// SetSkillOriginalLanguage sets the hub language when it was previously unspecified.
func (a *appCore) SetSkillOriginalLanguage(id, language string) error {
	if _, _, err := a.repo().Find(id); err != nil {
		return userErr(err)
	}
	return userErr(a.i18n().SetOriginalLanguage(id, language))
}

// RetagSkillDefaultLanguage renames the hub language tag without swapping content.
func (a *appCore) RetagSkillDefaultLanguage(id, language string) error {
	if _, _, err := a.repo().Find(id); err != nil {
		return userErr(err)
	}
	return userErr(a.i18n().RetagDefaultLanguage(id, language))
}

// SetSkillDefaultLanguage swaps the hub skill with a translation version.
func (a *appCore) SetSkillDefaultLanguage(id, language string) error {
	hubPath, err := a.resolveHubSkillPath(id)
	if err != nil {
		return userErr(err)
	}
	if err := a.i18n().SetDefault(id, language, hubPath); err != nil {
		return userErr(err)
	}
	// Hub path is unchanged; existing tool links still point at the same directory.
	return nil
}

// DeleteSkillLanguage permanently deletes a non-default translation version.
func (a *appCore) DeleteSkillLanguage(id, language string) error {
	if _, _, err := a.repo().Find(id); err != nil {
		return userErr(err)
	}
	return userErr(a.i18n().DeleteLanguage(id, language))
}

// TranslateSkillDescription translates a SKILL.md description using the
// translation preferences currently saved in the application settings.
func (a *appCore) TranslateSkillDescription(description string) (string, error) {
	return translator.Translate(
		context.Background(),
		translator.Config{
			Engine:                    a.cfg.TranslationEngine,
			TargetLanguage:            a.cfg.TranslationTargetLanguage,
			MicrosoftTranslatorKey:    a.cfg.MicrosoftTranslatorKey,
			MicrosoftTranslatorRegion: a.cfg.MicrosoftTranslatorRegion,
			OpenAIBaseURL:             a.cfg.OpenAIBaseURL,
			OpenAIAPIKey:              a.cfg.OpenAIAPIKey,
			OpenAIModel:               a.cfg.OpenAIModel,
			OpenAITemperature:         a.cfg.OpenAITemperature,
		},
		description,
	)
}

// StartSkillTranslation creates a translated language version in skills_translation.
// The global TranslationTargetLanguage is the only target. Progress is emitted via
// skilltranslation:progress. On success the returned value is the target language tag.
func (a *appCore) StartSkillTranslation(sourceID string) (string, error) {
	if a.cfg.TranslationEngine != translator.EngineOpenAICompatible {
		return "", errors.New("完整 skill 翻译仅支持 OpenAI 兼容引擎")
	}
	targetLanguage := strings.TrimSpace(a.cfg.TranslationTargetLanguage)
	if err := skilli18n.ValidateLanguage(targetLanguage); err != nil {
		return "", userErr(err)
	}
	store := a.i18n()
	info, err := store.Info(sourceID)
	if err != nil {
		return "", userErr(err)
	}
	if info.DefaultLanguage == "" {
		return "", errors.New("请先设置原版语言")
	}
	if targetLanguage == info.DefaultLanguage {
		return "", fmt.Errorf("目标语言与默认语言相同（%s）", skilli18n.LabelOf(targetLanguage))
	}
	exists, err := store.HasVersion(sourceID, targetLanguage)
	if err != nil {
		return "", userErr(err)
	}
	if exists {
		return "", fmt.Errorf("已存在 %s 翻译版本，请切换到该版本编辑", skilli18n.LabelOf(targetLanguage))
	}

	_, sourcePath, err := a.repo().Find(sourceID)
	if err != nil {
		return "", userErr(err)
	}
	if err := store.EnsureRoot(); err != nil {
		return "", userErr(err)
	}
	targetPath := store.VersionPath(sourceID, targetLanguage)

	a.skillTranslationMu.Lock()
	if a.skillTranslationActive {
		a.skillTranslationMu.Unlock()
		return "", errors.New("已有 skill 翻译任务正在运行")
	}
	jobID := applog.NewJobID("tr")
	ctx, cancel := context.WithCancel(applog.WithJobID(a.ctx, jobID))
	a.skillTranslationActive = true
	a.skillTranslationUserCancel = false
	a.skillTranslationCancel = cancel
	a.skillTranslationMu.Unlock()
	applog.Info("translate job start", "jobId", jobID, "skillId", sourceID, "targetLanguage", targetLanguage)

	cfg := a.cfg
	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				applog.Error("translate job panic", "jobId", jobID, "err", fmt.Sprint(recovered))
				runtime.EventsEmit(a.ctx, eventSkillTranslationProgress, map[string]any{
					"sourceID":       sourceID,
					"targetLanguage": targetLanguage,
					"phase":          "failed",
					"error":          fmt.Sprintf("翻译任务异常中断：%v", recovered),
				})
			}
			a.skillTranslationMu.Lock()
			a.skillTranslationActive = false
			a.skillTranslationCancel = nil
			a.skillTranslationUserCancel = false
			a.skillTranslationMu.Unlock()
		}()
		result, runErr := skilltranslate.Run(ctx, skilltranslate.Request{
			Source:         sourcePath,
			Target:         targetPath,
			TargetLanguage: targetLanguage,
			Overwrite:      false,
			Translate: func(ctx context.Context, instruction, text string) (string, error) {
				return translator.TranslateSkillDocument(ctx, translator.Config{
					Engine:                    cfg.TranslationEngine,
					TargetLanguage:            targetLanguage,
					MicrosoftTranslatorKey:    cfg.MicrosoftTranslatorKey,
					MicrosoftTranslatorRegion: cfg.MicrosoftTranslatorRegion,
					OpenAIBaseURL:             cfg.OpenAIBaseURL,
					OpenAIAPIKey:              cfg.OpenAIAPIKey,
					OpenAIModel:               cfg.OpenAIModel,
					OpenAITemperature:         cfg.OpenAITemperature,
				}, text, instruction)
			},
		}, func(progress skilltranslate.Progress) {
			applog.InfoContext(ctx, "translate progress",
				"phase", progress.Phase,
				"file", progress.File,
				"current", progress.Current,
				"total", progress.Total,
				"chunk", progress.Chunk,
				"chunkTotal", progress.ChunkTotal,
			)
			runtime.EventsEmit(a.ctx, eventSkillTranslationProgress, map[string]any{
				"sourceID":       sourceID,
				"targetLanguage": targetLanguage,
				"phase":          progress.Phase,
				"file":           progress.File,
				"current":        progress.Current,
				"total":          progress.Total,
				"chunk":          progress.Chunk,
				"chunkTotal":     progress.ChunkTotal,
			})
		})
		event := map[string]any{
			"sourceID":       sourceID,
			"targetLanguage": targetLanguage,
		}
		if runErr != nil {
			a.skillTranslationMu.Lock()
			userCancel := a.skillTranslationUserCancel
			a.skillTranslationMu.Unlock()
			switch {
			case userCancel && errors.Is(runErr, context.Canceled):
				event["phase"] = "cancelled"
				applog.InfoContext(ctx, "translate job cancelled")
			case errors.Is(runErr, context.Canceled):
				event["phase"] = "failed"
				event["error"] = "翻译任务被意外取消"
				applog.ErrorContext(ctx, "translate job fail", "err", runErr)
			default:
				event["phase"] = "failed"
				event["error"] = runErr.Error()
				applog.ErrorContext(ctx, "translate job fail", "err", runErr)
			}
			_ = os.RemoveAll(targetPath)
		} else {
			if metaErr := store.AddTranslationLanguage(sourceID, targetLanguage); metaErr != nil {
				exists, _ := store.HasVersion(sourceID, targetLanguage)
				if exists && fsutil.IsSkillDir(targetPath) {
					event["phase"] = "completed"
					event["files"] = result.Files
				} else {
					_ = os.RemoveAll(targetPath)
					event["phase"] = "failed"
					event["error"] = metaErr.Error()
				}
			} else {
				event["phase"] = "completed"
				event["files"] = result.Files
			}
		}
		if event["phase"] == "completed" {
			applog.InfoContext(ctx, "translate job ok", "files", result.Files)
		}
		runtime.EventsEmit(a.ctx, eventSkillTranslationProgress, event)
	}()
	return targetLanguage, nil
}

// CancelSkillTranslation requests cancellation of the currently running
// translation job. Its temporary copy is discarded by the worker.
func (a *appCore) CancelSkillTranslation() {
	applog.Info("translate job cancel requested")
	a.skillTranslationMu.Lock()
	defer a.skillTranslationMu.Unlock()
	a.skillTranslationUserCancel = true
	if a.skillTranslationCancel != nil {
		a.skillTranslationCancel()
	}
}

// SetSkillLink enables or disables a tool-side symlink for a skill.
func (a *appCore) SetSkillLink(skillID, toolID string, enabled bool) error {
	if err := a.requireElevated(); err != nil {
		return err
	}
	tool, ok := findTool(a.cfg, toolID)
	if !ok {
		return fmt.Errorf("未找到工具: %s", toolID)
	}
	if tool.IsHub {
		return fmt.Errorf("不能对源仓本身创建符号链接")
	}
	id := fsutil.NormalizeSkillID(skillID)
	if id == "" {
		return fmt.Errorf("skill id 不能为空")
	}
	hubPath, err := a.resolveHubSkillPath(id)
	if err != nil {
		return userErr(err)
	}
	linkPath := toolSkillPath(tool.Path, id)
	if enabled {
		if _, err := os.Stat(hubPath); err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("源仓中不存在该 skill: %s", id)
			}
			return userErr(err)
		}
		return userErr(linker.EnsureSymlink(linkPath, hubPath))
	}
	return userErr(linker.RemoveSymlink(linkPath))
}

// GetLinkSnapshot returns the saved link snapshot for a tool, or (nil, nil) if none.
func (a *appCore) GetLinkSnapshot(toolID string) (*config.LinkSnapshot, error) {
	if a.cfg.LinkSnapshots == nil {
		return nil, nil
	}
	snap, ok := a.cfg.LinkSnapshots[toolID]
	if !ok {
		return nil, nil
	}
	cp := snap
	return &cp, nil
}

// DisableAllSkillLinks removes all tool-side links for the given tools and saves snapshots.
func (a *appCore) DisableAllSkillLinks(toolIDs []string) (domain.BulkLinkResult, error) {
	if err := a.requireElevated(); err != nil {
		return domain.BulkLinkResult{}, err
	}
	entries, err := a.listMerged()
	if err != nil {
		return domain.BulkLinkResult{}, userErr(err)
	}
	res, err := bulklink.Disable(&a.cfg, entries, toolIDs)
	if err != nil {
		return domain.BulkLinkResult{}, userErr(err)
	}
	path := a.settingsPath
	if path == "" {
		p, err := config.DefaultSettingsPath()
		if err != nil {
			return domain.BulkLinkResult{}, userErr(err)
		}
		path = p
		a.settingsPath = p
	}
	if err := a.cfg.Save(path); err != nil {
		return res, userErr(fmt.Errorf("链接已移除但保存快照失败: %w", err))
	}
	return res, nil
}

// EnableSkillLinks restores or creates tool-side links for the given tools.
func (a *appCore) EnableSkillLinks(toolIDs []string, mode string) (domain.BulkLinkResult, error) {
	if err := a.requireElevated(); err != nil {
		return domain.BulkLinkResult{}, err
	}
	entries, err := a.listMerged()
	if err != nil {
		return domain.BulkLinkResult{}, userErr(err)
	}
	res, err := bulklink.Enable(&a.cfg, entries, toolIDs, mode)
	if err != nil {
		return domain.BulkLinkResult{}, userErr(err)
	}
	return res, nil
}

// PreviewOrganize builds and stores an organize plan for the current session.
func (a *appCore) PreviewOrganize() (domain.OrganizePlan, error) {
	plan, err := a.session().Preview(a.cfg)
	return plan, userErr(err)
}

// UpdateOrganizePlan replaces the session-held organize plan (e.g. Selected toggles).
func (a *appCore) UpdateOrganizePlan(plan domain.OrganizePlan) error {
	return userErr(a.session().Update(plan, a.cfg))
}

// ApplyConflictRound applies the current merge round for a skill and advances to the next Side B when needed.
func (a *appCore) ApplyConflictRound(skillID string) (domain.OrganizePlan, error) {
	plan, err := a.session().ApplyRound(skillID, a.cfg)
	if err != nil {
		return domain.OrganizePlan{}, userErr(err)
	}
	a.purgeTrash()
	return plan, nil
}

// SkipConflict marks a conflict skill as skipped for this session.
func (a *appCore) SkipConflict(skillID string) (domain.OrganizePlan, error) {
	plan, err := a.session().SkipSkillConflict(skillID)
	return plan, userErr(err)
}

// ResetConflict clears skip flag and file resolutions for a conflict skill.
func (a *appCore) ResetConflict(skillID string) (domain.OrganizePlan, error) {
	plan, err := a.session().ResetSkillConflict(skillID)
	return plan, userErr(err)
}

// ReadConflictFileTexts returns side-by-side text for a both_diff conflict file.
func (a *appCore) ReadConflictFileTexts(skillID, rel string) (domain.ConflictFileTexts, error) {
	texts, err := a.session().ReadConflictFileTexts(skillID, rel)
	return texts, userErr(err)
}

// SetConflictFileChoice sets keep_a / keep_b / manual for one conflict file.
func (a *appCore) SetConflictFileChoice(skillID, rel, choice, merged string) (domain.OrganizePlan, error) {
	plan, err := a.session().SetConflictFileChoice(skillID, rel, choice, merged)
	return plan, userErr(err)
}

// CanExecuteOrganize reports whether the session plan may be executed.
func (a *appCore) CanExecuteOrganize() (domain.CanExecuteResult, error) {
	res, err := a.session().CheckExecute()
	return res, userErr(err)
}

// ExecuteOrganize applies the session organize plan. Requires elevation.
func (a *appCore) ExecuteOrganize() (domain.OrganizeReport, error) {
	if err := a.requireElevated(); err != nil {
		return domain.OrganizeReport{}, err
	}
	jobID := applog.NewJobID("org")
	applog.Info("organize start", "jobId", jobID)
	report, err := a.session().Run(a.cfg)
	if err == nil {
		a.purgeTrash()
		applog.Info("organize ok", "jobId", jobID, "succeeded", len(report.Succeeded), "failed", len(report.Failed), "skipped", len(report.Skipped))
	} else {
		applog.Error("organize fail", "jobId", jobID, "err", err)
	}
	return report, userErr(err)
}

// ConfirmAddWorkdirs adds selected suggested workdirs to config and links skills.
func (a *appCore) ConfirmAddWorkdirs(paths []string) (domain.AddWorkdirsResult, error) {
	if err := a.requireElevated(); err != nil {
		return domain.AddWorkdirsResult{}, err
	}
	suggestions := a.session().SuggestedWorkdirs()
	if len(suggestions) == 0 {
		return domain.AddWorkdirsResult{}, userErr(fmt.Errorf("无待确认的建议工作目录，请先执行整理"))
	}
	if len(paths) == 0 {
		return domain.AddWorkdirsResult{}, nil
	}
	res, err := workdir.ConfirmAdd(&a.cfg, suggestions, paths, a.cfg.HubPath)
	if err != nil {
		return domain.AddWorkdirsResult{}, userErr(err)
	}
	if len(res.Added) > 0 {
		if err := a.persistSettings(); err != nil {
			return res, userErr(fmt.Errorf("保存配置失败: %w", err))
		}
	}
	return res, nil
}

// PreviewRestoreOrphanLinks scans the home directory for hub-pointing symlinks
// outside configured tool roots (leftovers from mistaken deep-scan organize).
func (a *appCore) PreviewRestoreOrphanLinks() ([]domain.RestoreOrphanItem, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, userErr(err)
	}
	items, err := a.session().PreviewRestoreOrphans(home, a.cfg, func(p string) {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, eventRestoreOrphanProgress, p)
		}
	})
	if err != nil {
		return nil, userErr(err)
	}
	return items, nil
}

// RestoreOrphanLinks converts selected hub-pointing symlinks back into real directories
// by moving skill content out of the hub to the original paths.
func (a *appCore) RestoreOrphanLinks(linkPaths []string) (domain.RestoreOrphanReport, error) {
	if err := a.requireElevated(); err != nil {
		return domain.RestoreOrphanReport{}, err
	}
	report, err := a.session().RestoreOrphans(linkPaths, a.cfg)
	if err != nil {
		return domain.RestoreOrphanReport{}, userErr(err)
	}
	if len(report.Succeeded) > 0 {
		a.purgeTrash()
	}
	return report, nil
}

// IsElevated reports whether the process has administrator privileges.
func (a *appCore) IsElevated() bool {
	return priv.IsElevated()
}

// RequestElevation relaunches the app with UAC elevation (Windows). The current
// unelevated process exits after a successful relaunch.
func (a *appCore) RequestElevation() error {
	applog.Info("elevation requested", "already", priv.IsElevated())
	if err := priv.RequestElevation(); err != nil {
		applog.Error("elevation fail", "err", err)
		return userErr(err)
	}
	return nil
}

func (a *appCore) listMerged() ([]domain.SkillEntry, error) {
	return scanner.Scan(a.cfg)
}

func findTool(cfg config.Config, toolID string) (config.ToolMapping, bool) {
	for _, t := range cfg.Tools {
		if t.ID == toolID {
			return t, true
		}
	}
	return config.ToolMapping{}, false
}

func (a *appCore) resolveHubSkillPath(skillID string) (string, error) {
	_, path, err := a.repo().Find(skillID)
	return path, err
}
