package fsutil

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

var defaultSkip = map[string]struct{}{
	"node_modules": {},
	".git":         {},
	"_trash":       {},
	".trash":       {},
	".system":      {}, // Codex 等工具的系统内置 skills，不纳入管理
	".bun":         {}, // Bun 全局缓存（~/.bun/install/cache 等）

	// 系统 / 用户配置与临时目录（深度扫描主目录时尤其需要）
	"AppData":          {},
	"Application Data": {},
	"Local Settings":   {},
	"Cookies":          {},
	"Recent":           {},
	"SendTo":           {},
	"Start Menu":       {},
	"Templates":        {},
	"NetHood":          {},
	"PrintHood":        {},
	"Temp":             {},
	"tmp":              {},
	".tmp":             {},
	".temp":            {},
	".cache":           {},
	"__pycache__":      {},
	".pytest_cache":    {},
	".mypy_cache":      {},
	".tox":             {},
	".venv":            {},
	"venv":             {},
	"site-packages":    {},

	// 包管理 / 运行时 / 模型缓存（常无权限或无 skill）
	".paddlex":     {}, // 飞桨 PaddleX 官方模型缓存
	".paddleocr":   {},
	".paddle":      {},
	".huggingface": {},
	".modelscope":  {},
	".torch":       {},
	".keras":       {},
	".npm":         {},
	".yarn":        {},
	".pnpm-store":  {},
	".nuget":       {},
	".cargo":       {},
	".rustup":      {},
	".conda":       {},
	".mamba":       {},
	".docker":      {},
	".local":       {},
	".gradle":      {},
	".m2":          {},
	".nv":          {},
}

// SamePath reports whether a and b name the same location without following
// symlinks. Empty or whitespace-only strings are never equal. Comparison is
// case-insensitive on Windows and case-sensitive elsewhere.
func SamePath(a, b string) bool {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == "" || b == "" {
		return false
	}
	aa, errA := filepath.Abs(a)
	bb, errB := filepath.Abs(b)
	if errA != nil || errB != nil {
		aa, bb = filepath.Clean(a), filepath.Clean(b)
	} else {
		aa, bb = filepath.Clean(aa), filepath.Clean(bb)
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(aa, bb)
	}
	return aa == bb
}

func NormalizeSkillID(rel string) string {
	rel = strings.ReplaceAll(rel, "\\", "/")
	rel = filepath.ToSlash(rel)
	rel = strings.TrimPrefix(rel, "./")
	return strings.Trim(rel, "/")
}

func ShouldSkipDir(name string) bool {
	if _, ok := defaultSkip[name]; ok {
		return true
	}
	// Hidden staging directories created while translating or publishing a skill
	// copy. They contain SKILL.md, so scanners would otherwise treat them as
	// real skills until the atomic rename finishes.
	if strings.Contains(name, ".__translating-") || strings.Contains(name, ".__backup-") {
		return true
	}
	return false
}

func IsSkillDir(dir string) bool {
	st, err := os.Stat(filepath.Join(dir, "SKILL.md"))
	return err == nil && !st.IsDir()
}

func RelSkillID(root, skillDir string) (string, error) {
	rel, err := filepath.Rel(root, skillDir)
	if err != nil {
		return "", err
	}
	return NormalizeSkillID(rel), nil
}
