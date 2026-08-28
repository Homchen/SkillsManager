package skilli18n

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"SkillsManager/internal/fsutil"
)

const (
	// DirName is the sibling directory of the hub that stores non-default versions.
	DirName      = "skills_translation"
	metaFileName = "metadata.json"
)

var (
	errEmptyLanguage = errors.New("语言不能为空")
)

func errUnsupportedLanguage(tag string) error {
	return fmt.Errorf("不支持的语言：%s", tag)
}

// Metadata persists the default language and known versions for one skill.
type Metadata struct {
	DefaultLanguage string   `json:"defaultLanguage"`
	Languages       []string `json:"languages"`
}

// Info is the API-facing snapshot of a skill's language versions.
type Info struct {
	DefaultLanguage  string   `json:"defaultLanguage"`
	Languages        []string `json:"languages"`
	TranslationCount int      `json:"translationCount"`
}

// Store manages skills_translation/<skill-id>/ trees next to the hub.
type Store struct {
	Hub string
}

// New returns a store rooted beside hubPath.
func New(hubPath string) *Store {
	return &Store{Hub: hubPath}
}

// Root is the absolute path of the translation repository.
func (s *Store) Root() string {
	return filepath.Join(filepath.Dir(s.Hub), DirName)
}

// SkillDir is skills_translation/<skill-id>.
func (s *Store) SkillDir(id string) string {
	return filepath.Join(s.Root(), fsutil.NormalizeSkillID(id))
}

// MetaPath is skills_translation/<skill-id>/metadata.json.
func (s *Store) MetaPath(id string) string {
	return filepath.Join(s.SkillDir(id), metaFileName)
}

// VersionPath is skills_translation/<skill-id>/<language-tag>.
func (s *Store) VersionPath(id, language string) string {
	return filepath.Join(s.SkillDir(id), strings.TrimSpace(language))
}

// EnsureRoot creates the translation repository directory if needed.
func (s *Store) EnsureRoot() error {
	return os.MkdirAll(s.Root(), 0o755)
}

// Load reads metadata for a skill. Missing files yield empty metadata.
func (s *Store) Load(id string) (Metadata, error) {
	id = fsutil.NormalizeSkillID(id)
	path := s.MetaPath(id)
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Metadata{}, nil
		}
		return Metadata{}, err
	}
	var meta Metadata
	if err := json.Unmarshal(b, &meta); err != nil {
		return Metadata{}, fmt.Errorf("解析翻译元数据失败：%w", err)
	}
	meta.DefaultLanguage = strings.TrimSpace(meta.DefaultLanguage)
	meta.Languages = normalizeLanguageList(meta.Languages)
	return meta, nil
}

// Save writes metadata atomically.
func (s *Store) Save(id string, meta Metadata) error {
	id = fsutil.NormalizeSkillID(id)
	meta.DefaultLanguage = strings.TrimSpace(meta.DefaultLanguage)
	meta.Languages = normalizeLanguageList(meta.Languages)
	if meta.DefaultLanguage != "" && !containsLang(meta.Languages, meta.DefaultLanguage) {
		meta.Languages = append(meta.Languages, meta.DefaultLanguage)
		meta.Languages = normalizeLanguageList(meta.Languages)
	}
	if err := os.MkdirAll(s.SkillDir(id), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.MetaPath(id) + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.MetaPath(id))
}

// Info returns UI-facing language info, reconciling metadata with on-disk versions.
func (s *Store) Info(id string) (Info, error) {
	meta, err := s.Reconcile(id)
	if err != nil {
		return Info{}, err
	}
	count := 0
	for _, lang := range meta.Languages {
		if lang != "" && lang != meta.DefaultLanguage {
			count++
		}
	}
	return Info{
		DefaultLanguage:  meta.DefaultLanguage,
		Languages:        append([]string(nil), meta.Languages...),
		TranslationCount: count,
	}, nil
}

// Reconcile loads metadata and adds any on-disk version directories that are missing.
func (s *Store) Reconcile(id string) (Metadata, error) {
	id = fsutil.NormalizeSkillID(id)
	meta, err := s.Load(id)
	if err != nil {
		return Metadata{}, err
	}
	disk, err := s.listVersionDirs(id)
	if err != nil {
		return Metadata{}, err
	}
	diskSet := make(map[string]struct{}, len(disk))
	for _, lang := range disk {
		diskSet[lang] = struct{}{}
	}

	changed := false
	next := make([]string, 0, len(meta.Languages)+len(disk)+1)
	seen := make(map[string]struct{}, len(meta.Languages)+len(disk)+1)

	add := func(lang string) {
		lang = strings.TrimSpace(lang)
		if lang == "" {
			return
		}
		if _, ok := seen[lang]; ok {
			return
		}
		seen[lang] = struct{}{}
		next = append(next, lang)
	}

	// Default lives in the hub, not under translation dirs — always keep it.
	if meta.DefaultLanguage != "" {
		add(meta.DefaultLanguage)
	}
	// Keep only non-default languages that still exist on disk.
	for _, lang := range meta.Languages {
		if lang == meta.DefaultLanguage {
			continue
		}
		if _, ok := diskSet[lang]; ok {
			add(lang)
		} else {
			changed = true
		}
	}
	// Discover newly added version directories.
	for _, lang := range disk {
		if !containsLang(next, lang) {
			add(lang)
			changed = true
		}
	}

	normalized := normalizeLanguageList(next)
	if len(normalized) != len(meta.Languages) {
		changed = true
	} else {
		for i := range normalized {
			if normalized[i] != meta.Languages[i] {
				changed = true
				break
			}
		}
	}
	meta.Languages = normalized
	if changed {
		if err := s.Save(id, meta); err != nil {
			return Metadata{}, err
		}
	}
	return meta, nil
}

// InitDefault records the hub language for a newly created skill.
func (s *Store) InitDefault(id, language string) error {
	if err := ValidateLanguage(language); err != nil {
		return err
	}
	meta, err := s.Load(id)
	if err != nil {
		return err
	}
	if meta.DefaultLanguage != "" && meta.DefaultLanguage != language {
		return fmt.Errorf("原版语言已设置为 %s", meta.DefaultLanguage)
	}
	meta.DefaultLanguage = language
	if !containsLang(meta.Languages, language) {
		meta.Languages = append(meta.Languages, language)
	}
	return s.Save(id, meta)
}

// SetOriginalLanguage sets the hub language when it was previously unspecified.
func (s *Store) SetOriginalLanguage(id, language string) error {
	if err := ValidateLanguage(language); err != nil {
		return err
	}
	meta, err := s.Load(id)
	if err != nil {
		return err
	}
	if meta.DefaultLanguage != "" {
		return fmt.Errorf("原版语言已设置为 %s", LabelOf(meta.DefaultLanguage))
	}
	meta.DefaultLanguage = language
	if !containsLang(meta.Languages, language) {
		meta.Languages = append(meta.Languages, language)
	}
	return s.Save(id, meta)
}

// RetagDefaultLanguage renames the hub language tag without moving skill files.
// Use when the original language was set incorrectly.
func (s *Store) RetagDefaultLanguage(id, language string) error {
	if err := ValidateLanguage(language); err != nil {
		return err
	}
	meta, err := s.Reconcile(id)
	if err != nil {
		return err
	}
	if meta.DefaultLanguage == "" {
		return errors.New("请先设置原版语言")
	}
	if language == meta.DefaultLanguage {
		return nil
	}
	if containsLang(meta.Languages, language) || fsutil.IsSkillDir(s.VersionPath(id, language)) {
		return fmt.Errorf("已存在「%s」语言版本，无法将原版改为该语言", LabelOf(language))
	}

	old := meta.DefaultLanguage
	next := make([]string, 0, len(meta.Languages))
	for _, lang := range meta.Languages {
		if lang == old {
			continue
		}
		next = append(next, lang)
	}
	next = append(next, language)
	meta.DefaultLanguage = language
	meta.Languages = next
	return s.Save(id, meta)
}

// HasVersion reports whether language exists (default in hub counts as existing).
func (s *Store) HasVersion(id, language string) (bool, error) {
	meta, err := s.Reconcile(id)
	if err != nil {
		return false, err
	}
	language = strings.TrimSpace(language)
	if language == "" {
		return false, nil
	}
	if language == meta.DefaultLanguage {
		return true, nil
	}
	return containsLang(meta.Languages, language) && fsutil.IsSkillDir(s.VersionPath(id, language)), nil
}

// AddTranslationLanguage records a newly published non-default version.
func (s *Store) AddTranslationLanguage(id, language string) error {
	if err := ValidateLanguage(language); err != nil {
		return err
	}
	meta, err := s.Load(id)
	if err != nil {
		return err
	}
	if meta.DefaultLanguage == "" {
		return errors.New("请先设置原版语言")
	}
	if language == meta.DefaultLanguage {
		return errors.New("目标语言与默认语言相同")
	}
	if containsLang(meta.Languages, language) {
		return fmt.Errorf("已存在 %s 翻译版本", LabelOf(language))
	}
	if !fsutil.IsSkillDir(s.VersionPath(id, language)) {
		return fmt.Errorf("翻译版本目录不存在：%s", language)
	}
	meta.Languages = append(meta.Languages, language)
	return s.Save(id, meta)
}

// ResolveRoot returns the absolute skill directory for the requested language.
// Empty language resolves to the hub (default) path provided by hubPath.
func (s *Store) ResolveRoot(id, language, hubPath string) (string, error) {
	meta, err := s.Reconcile(id)
	if err != nil {
		return "", err
	}
	language = strings.TrimSpace(language)
	if language == "" || language == meta.DefaultLanguage {
		return hubPath, nil
	}
	path := s.VersionPath(id, language)
	if !fsutil.IsSkillDir(path) {
		return "", fmt.Errorf("未找到语言版本：%s", LabelOf(language))
	}
	return path, nil
}

// SetDefault swaps the hub skill with a non-default translation version.
func (s *Store) SetDefault(id, newLanguage, hubPath string) error {
	if err := ValidateLanguage(newLanguage); err != nil {
		return err
	}
	meta, err := s.Reconcile(id)
	if err != nil {
		return err
	}
	if meta.DefaultLanguage == "" {
		return errors.New("请先设置原版语言")
	}
	if newLanguage == meta.DefaultLanguage {
		return nil
	}
	srcVersion := s.VersionPath(id, newLanguage)
	if !fsutil.IsSkillDir(srcVersion) {
		return fmt.Errorf("未找到语言版本：%s", LabelOf(newLanguage))
	}
	if !fsutil.IsSkillDir(hubPath) {
		return errors.New("源仓中不存在该 skill")
	}

	oldLanguage := meta.DefaultLanguage
	skillDir := s.SkillDir(id)
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		return err
	}

	stagingOld := filepath.Join(skillDir, "."+oldLanguage+".__swap-old")
	stagingNew := filepath.Join(skillDir, "."+newLanguage+".__swap-new")
	_ = os.RemoveAll(stagingOld)
	_ = os.RemoveAll(stagingNew)

	if err := os.Rename(hubPath, stagingOld); err != nil {
		return fmt.Errorf("移出当前默认版本失败：%w", err)
	}
	if err := os.Rename(srcVersion, stagingNew); err != nil {
		_ = os.Rename(stagingOld, hubPath)
		return fmt.Errorf("移出目标翻译版本失败：%w", err)
	}
	if err := os.Rename(stagingNew, hubPath); err != nil {
		_ = os.Rename(stagingNew, srcVersion)
		_ = os.Rename(stagingOld, hubPath)
		return fmt.Errorf("写入新默认版本失败：%w", err)
	}
	destOld := s.VersionPath(id, oldLanguage)
	if err := os.Rename(stagingOld, destOld); err != nil {
		// Best-effort rollback: restore previous hub and translation locations.
		_ = os.Rename(hubPath, stagingNew)
		_ = os.Rename(stagingNew, srcVersion)
		_ = os.Rename(stagingOld, hubPath)
		return fmt.Errorf("保存旧默认版本失败：%w", err)
	}

	meta.DefaultLanguage = newLanguage
	if !containsLang(meta.Languages, oldLanguage) {
		meta.Languages = append(meta.Languages, oldLanguage)
	}
	if !containsLang(meta.Languages, newLanguage) {
		meta.Languages = append(meta.Languages, newLanguage)
	}
	if err := s.Save(id, meta); err != nil {
		if rbErr := rollbackSetDefaultSwap(hubPath, srcVersion, destOld, stagingOld, stagingNew); rbErr != nil {
			return fmt.Errorf("保存语言元数据失败：%w（回滚失败：%v）", err, rbErr)
		}
		return fmt.Errorf("保存语言元数据失败：%w", err)
	}
	return nil
}

func rollbackSetDefaultSwap(hubPath, srcVersion, destOld, stagingOld, stagingNew string) error {
	_ = os.RemoveAll(stagingOld)
	_ = os.RemoveAll(stagingNew)
	if err := os.Rename(destOld, stagingOld); err != nil {
		return err
	}
	if err := os.Rename(hubPath, stagingNew); err != nil {
		_ = os.Rename(stagingOld, destOld)
		return err
	}
	if err := os.Rename(stagingNew, srcVersion); err != nil {
		_ = os.Rename(stagingNew, hubPath)
		_ = os.Rename(stagingOld, destOld)
		return err
	}
	if err := os.Rename(stagingOld, hubPath); err != nil {
		_ = os.Rename(srcVersion, stagingNew)
		_ = os.Rename(stagingNew, hubPath)
		_ = os.Rename(stagingOld, destOld)
		return err
	}
	return nil
}

// DeleteLanguage removes a non-default translation version.
func (s *Store) DeleteLanguage(id, language string) error {
	if err := ValidateLanguage(language); err != nil {
		return err
	}
	meta, err := s.Reconcile(id)
	if err != nil {
		return err
	}
	if meta.DefaultLanguage == "" {
		return errors.New("请先设置原版语言")
	}
	if language == meta.DefaultLanguage {
		return errors.New("不能删除默认语言版本，请先将其他版本设为默认")
	}
	path := s.VersionPath(id, language)
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("未找到语言版本：%s", LabelOf(language))
		}
		return err
	}
	if err := os.RemoveAll(path); err != nil {
		return err
	}
	next := make([]string, 0, len(meta.Languages))
	for _, lang := range meta.Languages {
		if lang != language {
			next = append(next, lang)
		}
	}
	meta.Languages = next
	return s.Save(id, meta)
}

// RemoveAll deletes the entire translation tree for a skill.
func (s *Store) RemoveAll(id string) error {
	id = fsutil.NormalizeSkillID(id)
	path := s.SkillDir(id)
	if err := os.RemoveAll(path); err != nil {
		return err
	}
	return nil
}

// Rename moves the translation tree when a skill id changes.
func (s *Store) Rename(oldID, newID string) error {
	oldID = fsutil.NormalizeSkillID(oldID)
	newID = fsutil.NormalizeSkillID(newID)
	src := s.SkillDir(oldID)
	if _, err := os.Stat(src); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	dst := s.SkillDir(newID)
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("翻译仓中已存在 skill：%s", newID)
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.Rename(src, dst)
}

func (s *Store) listVersionDirs(id string) ([]string, error) {
	dir := s.SkillDir(id)
	ents, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []string
	for _, e := range ents {
		if !e.IsDir() || fsutil.ShouldSkipDir(e.Name()) {
			continue
		}
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		cand := filepath.Join(dir, name)
		if fsutil.IsSkillDir(cand) {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out, nil
}

func normalizeLanguageList(langs []string) []string {
	seen := make(map[string]struct{}, len(langs))
	out := make([]string, 0, len(langs))
	for _, lang := range langs {
		lang = strings.TrimSpace(lang)
		if lang == "" {
			continue
		}
		if _, ok := seen[lang]; ok {
			continue
		}
		seen[lang] = struct{}{}
		out = append(out, lang)
	}
	sort.Strings(out)
	return out
}

func containsLang(langs []string, want string) bool {
	want = strings.TrimSpace(want)
	for _, lang := range langs {
		if lang == want {
			return true
		}
	}
	return false
}

// MigrateRoot moves skills_translation when the hub path changes.
func MigrateRoot(oldHub, newHub string) error {
	oldHub = strings.TrimSpace(oldHub)
	newHub = strings.TrimSpace(newHub)
	if oldHub == "" || newHub == "" {
		return nil
	}
	oldRoot := filepath.Join(filepath.Dir(oldHub), DirName)
	newRoot := filepath.Join(filepath.Dir(newHub), DirName)
	if filepath.Clean(oldRoot) == filepath.Clean(newRoot) {
		return nil
	}
	if _, err := os.Stat(oldRoot); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if _, err := os.Stat(newRoot); err == nil {
		// Destination already has a translation repo; leave the old one in place.
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(newRoot), 0o755); err != nil {
		return err
	}
	return os.Rename(oldRoot, newRoot)
}
