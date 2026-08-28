package organizer

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"SkillsManager/internal/domain"
	"SkillsManager/internal/fsutil"
	"SkillsManager/internal/trash"
)

// BuildConflict compares two skill directory roots and classifies every file.
func BuildConflict(sideA, sideB string) (domain.ConflictSkill, error) {
	filesA, err := listFiles(sideA)
	if err != nil {
		return domain.ConflictSkill{}, err
	}
	filesB, err := listFiles(sideB)
	if err != nil {
		return domain.ConflictSkill{}, err
	}

	rels := make(map[string]struct{}, len(filesA)+len(filesB))
	for rel := range filesA {
		rels[rel] = struct{}{}
	}
	for rel := range filesB {
		rels[rel] = struct{}{}
	}
	ordered := make([]string, 0, len(rels))
	for rel := range rels {
		ordered = append(ordered, rel)
	}
	sort.Strings(ordered)

	out := domain.ConflictSkill{
		SideA: sideA,
		SideB: sideB,
		Files: make([]domain.ConflictFile, 0, len(ordered)),
		Index: 1,
		Total: 1,
	}
	for _, rel := range ordered {
		pathA, okA := filesA[rel]
		pathB, okB := filesB[rel]
		cf := domain.ConflictFile{RelativePath: rel}
		switch {
		case okA && !okB:
			cf.Status = domain.FileOnlyA
			cf.IsText = isTextFile(pathA)
		case !okA && okB:
			cf.Status = domain.FileOnlyB
			cf.IsText = isTextFile(pathB)
		default:
			same, err := fileContentsEqual(pathA, pathB)
			if err != nil {
				return domain.ConflictSkill{}, err
			}
			if same {
				cf.Status = domain.FileBothSame
			} else {
				cf.Status = domain.FileBothDiff
			}
			cf.IsText = isTextFile(pathA) && isTextFile(pathB)
		}
		out.Files = append(out.Files, cf)
	}
	return out, nil
}

// SkipConflict marks a conflict skill as skipped for this organize session.
func SkipConflict(c *domain.ConflictSkill) {
	if c == nil {
		return
	}
	c.UserSkipped = true
}

// ResetConflict clears skip flag and all file resolutions without writing disk.
func ResetConflict(c *domain.ConflictSkill) {
	if c == nil {
		return
	}
	c.UserSkipped = false
	for i := range c.Files {
		c.Files[i].Choice = ""
		c.Files[i].MergedContent = ""
	}
}

// ApplyConflictToHub writes the resolved conflict tree into hubPath.
// Prefers writing to a temporary directory then replacing the destination.
func ApplyConflictToHub(conflict domain.ConflictSkill, hubPath string) error {
	if conflict.SideA == "" || conflict.SideB == "" {
		return fmt.Errorf("冲突两侧路径不能为空")
	}
	parent := filepath.Dir(hubPath)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	tmp, err := os.MkdirTemp(parent, ".merge-tmp-*")
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.RemoveAll(tmp)
		}
	}()

	for _, f := range conflict.Files {
		if err := writeResolvedFile(conflict, f, tmp); err != nil {
			return err
		}
	}

	if fsutil.SamePath(hubPath, tmp) {
		committed = true
		return nil
	}
	if _, err := os.Lstat(hubPath); err == nil {
		if err := swapInMergedTree(hubPath, tmp); err != nil {
			return err
		}
		committed = true
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.Rename(tmp, hubPath); err != nil {
		return fmt.Errorf("写入源仓失败: %w", err)
	}
	committed = true
	return nil
}

// swapInMergedTree replaces hubPath with the merged tree in tmp.
// Prefers atomic rename; on Windows sharing violations falls back to in-place
// content replace so the hub directory inode/path need not be renamed.
func swapInMergedTree(hubPath, tmp string) error {
	backup := hubPath + ".pre-merge-bak"
	_ = os.RemoveAll(backup)

	var renameErr error
	for attempt := 0; attempt < 5; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 120 * time.Millisecond)
		}
		renameErr = os.Rename(hubPath, backup)
		if renameErr == nil {
			break
		}
	}
	if renameErr == nil {
		if err := os.Rename(tmp, hubPath); err != nil {
			if rbErr := os.Rename(backup, hubPath); rbErr != nil {
				return fmt.Errorf("替换源仓目录失败: %v；回滚亦失败，原内容在 %s: %w", err, backup, rbErr)
			}
			return fmt.Errorf("替换源仓目录失败: %w", err)
		}
		_ = os.RemoveAll(backup)
		return nil
	}

	if err := replaceDirContents(hubPath, tmp); err != nil {
		return fmt.Errorf("备份旧源仓目录失败: %v；就地写入亦失败: %w。请关闭占用该目录的程序（资源管理器/编辑器/杀毒软件）后重试：%s", renameErr, err, hubPath)
	}
	return nil
}

// replaceDirContents copies hubPath to a backup, then replaces its children with tmp.
// On any failure the backup is copied back so the hub is not left empty.
func replaceDirContents(hubPath, tmp string) error {
	backup := hubPath + ".pre-merge-bak"
	if err := fsutil.CopyTree(hubPath, backup); err != nil {
		_ = os.RemoveAll(backup)
		return fmt.Errorf("无法备份旧内容: %w", err)
	}
	rollback := func(cause error) error {
		if rerr := restoreDirFromBackup(hubPath, backup); rerr != nil {
			return fmt.Errorf("%w；回滚失败，原内容备份在 %s: %v", cause, backup, rerr)
		}
		_ = os.RemoveAll(backup)
		return cause
	}
	if err := clearDirEntries(hubPath); err != nil {
		return rollback(err)
	}
	if err := moveDirChildren(tmp, hubPath); err != nil {
		return rollback(err)
	}
	_ = os.RemoveAll(backup)
	_ = os.RemoveAll(tmp)
	return nil
}

func clearDirEntries(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		p := filepath.Join(dir, e.Name())
		if err := os.RemoveAll(p); err != nil {
			return fmt.Errorf("清理旧内容 %s: %w", e.Name(), err)
		}
	}
	return nil
}

func moveDirChildren(srcDir, dstDir string) error {
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		src := filepath.Join(srcDir, e.Name())
		dst := filepath.Join(dstDir, e.Name())
		if err := os.Rename(src, dst); err != nil {
			if copyErr := fsutil.CopyTree(src, dst); copyErr != nil {
				_ = os.RemoveAll(dst)
				return fmt.Errorf("写入 %s: %v；复制回退: %w", e.Name(), err, copyErr)
			}
			_ = os.RemoveAll(src)
		}
	}
	return nil
}

func restoreDirFromBackup(hubPath, backup string) error {
	if err := clearDirEntries(hubPath); err != nil {
		return fmt.Errorf("回滚前清理失败: %w", err)
	}
	if err := fsutil.CopyTree(backup, hubPath); err != nil {
		return fmt.Errorf("从备份恢复失败: %w", err)
	}
	return nil
}

func writeResolvedFile(conflict domain.ConflictSkill, f domain.ConflictFile, destRoot string) error {
	dest, err := fsutil.SafeJoinUnder(destRoot, f.RelativePath)
	if err != nil {
		return fmt.Errorf("非法相对路径: %w", err)
	}
	choice := effectiveChoice(f)
	switch choice {
	case domain.ChoiceManual:
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		return os.WriteFile(dest, []byte(f.MergedContent), 0o644)
	case domain.ChoiceKeepA:
		src, err := fsutil.SafeJoinUnder(conflict.SideA, f.RelativePath)
		if err != nil {
			return err
		}
		return fsutil.CopyTree(src, dest)
	case domain.ChoiceKeepB:
		src, err := fsutil.SafeJoinUnder(conflict.SideB, f.RelativePath)
		if err != nil {
			return err
		}
		return fsutil.CopyTree(src, dest)
	default:
		return fmt.Errorf("无法解析文件决议: %s", f.RelativePath)
	}
}

func effectiveChoice(f domain.ConflictFile) domain.FileChoice {
	if f.Choice != "" {
		return f.Choice
	}
	switch f.Status {
	case domain.FileOnlyA, domain.FileBothSame:
		return domain.ChoiceKeepA
	case domain.FileOnlyB:
		return domain.ChoiceKeepB
	default:
		return f.Choice
	}
}

// CanExecute reports whether the plan has no unresolved, non-skipped conflicts.
func CanExecute(plan domain.OrganizePlan) (bool, string) {
	for _, c := range plan.Conflicts {
		if c.UserSkipped {
			continue
		}
		if len(c.Files) == 0 {
			if c.SkillID == "" {
				return false, "存在未正确构建的冲突（文件列表为空）"
			}
			return false, fmt.Sprintf("技能 %s 的冲突未正确构建（文件列表为空）", c.SkillID)
		}
		for _, f := range c.Files {
			if reason := unresolvedFileReason(c.SkillID, f); reason != "" {
				return false, reason
			}
		}
		if c.Total > 0 && (c.Index < c.Total || len(c.PendingSources) > 0) {
			return false, fmt.Sprintf("技能 %s 还有未完成的合并轮次（冲突 %d/%d），请先应用本轮合并", c.SkillID, c.Index, c.Total)
		}
	}
	return true, ""
}

// ConflictRoundResolved reports whether the current merge round has all file choices.
func ConflictRoundResolved(c domain.ConflictSkill) (bool, string) {
	if c.UserSkipped {
		return true, ""
	}
	if len(c.Files) == 0 {
		return false, fmt.Sprintf("技能 %s 的冲突未正确构建（文件列表为空）", c.SkillID)
	}
	for _, f := range c.Files {
		if reason := unresolvedFileReason(c.SkillID, f); reason != "" {
			return false, reason
		}
	}
	return true, ""
}

// ApplyConflictRound writes the current round into hubPath, trashes only the
// sides that participated in this round (never unmerged PendingSources), then
// advances Side B to the next pending real copy when any remain.
// Index and PendingSources change only after BuildConflict succeeds; a failed
// next-round build leaves the session pointer on the current round.
func ApplyConflictRound(c *domain.ConflictSkill, hubPath string, tr *trash.Store) error {
	if c == nil {
		return fmt.Errorf("冲突数据为空")
	}
	if ok, reason := ConflictRoundResolved(*c); !ok {
		return fmt.Errorf("%s", reason)
	}
	if tr == nil {
		return fmt.Errorf("回收站未初始化")
	}
	if err := ApplyConflictToHub(*c, hubPath); err != nil {
		return err
	}

	for _, side := range []string{c.SideA, c.SideB} {
		if side == "" || fsutil.SamePath(side, hubPath) {
			continue
		}
		if _, err := os.Lstat(side); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return fmt.Errorf("检查冲突侧失败 %s: %w", side, err)
		}
		if _, err := tr.Move(side); err != nil {
			return fmt.Errorf("移入回收站失败 %s: %w", side, err)
		}
	}

	if len(c.PendingSources) == 0 {
		return nil
	}

	next := c.PendingSources[0]
	rebuilt, err := BuildConflict(hubPath, next)
	if err != nil {
		return fmt.Errorf("构建下一轮冲突失败：%w", err)
	}
	c.PendingSources = append([]string(nil), c.PendingSources[1:]...)
	c.Index++
	c.SideA = hubPath
	c.SideB = next
	c.Files = rebuilt.Files
	c.UserSkipped = false
	return nil
}

func unresolvedFileReason(skillID string, f domain.ConflictFile) string {
	switch f.Status {
	case domain.FileOnlyA, domain.FileOnlyB, domain.FileBothSame:
		// only_a defaults keep_a; only_b defaults keep_b; both_same needs no choice.
		return ""
	case domain.FileBothDiff:
		switch f.Choice {
		case "":
			if skillID == "" {
				return fmt.Sprintf("存在未决议的冲突文件：%s", f.RelativePath)
			}
			return fmt.Sprintf("技能 %s 存在未决议的冲突文件：%s", skillID, f.RelativePath)
		case domain.ChoiceKeepA, domain.ChoiceKeepB:
			return ""
		case domain.ChoiceManual:
			if !f.IsText {
				if skillID == "" {
					return fmt.Sprintf("非文本文件不支持手动合并：%s", f.RelativePath)
				}
				return fmt.Sprintf("技能 %s 的非文本文件不支持手动合并：%s", skillID, f.RelativePath)
			}
			if f.MergedContent == "" {
				if skillID == "" {
					return fmt.Sprintf("手动合并内容为空：%s", f.RelativePath)
				}
				return fmt.Sprintf("技能 %s 的手动合并内容为空：%s", skillID, f.RelativePath)
			}
			return ""
		default:
			if skillID == "" {
				return fmt.Sprintf("无效的冲突选择：%s", f.RelativePath)
			}
			return fmt.Sprintf("技能 %s 存在无效的冲突选择：%s", skillID, f.RelativePath)
		}
	default:
		return ""
	}
}

func listFiles(root string) (map[string]string, error) {
	if st, err := os.Stat(root); err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("路径不存在：%s", root)
		}
		return nil, fmt.Errorf("无法访问路径 %s：%w", root, err)
	} else if !st.IsDir() {
		return nil, fmt.Errorf("不是目录：%s", root)
	}
	out := map[string]string{}
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&os.ModeSymlink != 0 {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if path != root && fsutil.ShouldSkipDir(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		out[filepath.ToSlash(rel)] = path
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func fileContentsEqual(a, b string) (bool, error) {
	ba, err := os.ReadFile(a)
	if err != nil {
		return false, err
	}
	bb, err := os.ReadFile(b)
	if err != nil {
		return false, err
	}
	na := normalizeNewlines(ba)
	nb := normalizeNewlines(bb)
	if bytes.Equal(na, nb) {
		return true, nil
	}
	// 与前端 lineDiff 对齐：UTF-8 文本忽略 BOM、行尾空白、末尾多余换行
	if isTextBytes(na) && isTextBytes(nb) && textLinesEquivalent(na, nb) {
		return true, nil
	}
	return false, nil
}

// normalizeNewlines maps CRLF/CR to LF so line-ending-only copies are not both_diff.
func normalizeNewlines(b []byte) []byte {
	if !bytes.Contains(b, []byte{'\r'}) {
		return b
	}
	b = bytes.ReplaceAll(b, []byte{'\r', '\n'}, []byte{'\n'})
	b = bytes.ReplaceAll(b, []byte{'\r'}, []byte{'\n'})
	return b
}

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

func isTextBytes(b []byte) bool {
	if bytes.IndexByte(b, 0) >= 0 {
		return false
	}
	return utf8.Valid(b)
}

func textLinesEquivalent(a, b []byte) bool {
	la := splitComparableLines(a)
	lb := splitComparableLines(b)
	if len(la) != len(lb) {
		return false
	}
	for i := range la {
		if trimTrailingWS(la[i]) != trimTrailingWS(lb[i]) {
			return false
		}
	}
	return true
}

func splitComparableLines(b []byte) []string {
	b = bytes.TrimPrefix(b, utf8BOM)
	if len(b) == 0 {
		return nil
	}
	parts := strings.Split(string(b), "\n")
	if n := len(parts); n > 0 && parts[n-1] == "" {
		parts = parts[:n-1]
	}
	return parts
}

func trimTrailingWS(s string) string {
	return strings.TrimRight(s, " \t")
}

// ReadConflictSideTexts reads UTF-8 text from both conflict sides for a relative path.
func ReadConflictSideTexts(c domain.ConflictSkill, rel string) (domain.ConflictFileTexts, error) {
	rel = filepath.ToSlash(rel)
	if rel == "" || strings.Contains(rel, "..") {
		return domain.ConflictFileTexts{}, fmt.Errorf("非法相对路径: %s", rel)
	}
	pathA, err := safeJoinUnder(c.SideA, rel)
	if err != nil {
		return domain.ConflictFileTexts{}, err
	}
	pathB, err := safeJoinUnder(c.SideB, rel)
	if err != nil {
		return domain.ConflictFileTexts{}, err
	}
	textA, err := readTextSide(pathA)
	if err != nil {
		return domain.ConflictFileTexts{}, fmt.Errorf("读取侧 A 失败：%w", err)
	}
	textB, err := readTextSide(pathB)
	if err != nil {
		return domain.ConflictFileTexts{}, fmt.Errorf("读取侧 B 失败：%w", err)
	}
	return domain.ConflictFileTexts{
		SkillID: c.SkillID,
		Rel:     rel,
		SideA:   textA,
		SideB:   textB,
	}, nil
}

func safeJoinUnder(root, rel string) (string, error) {
	if root == "" {
		return "", fmt.Errorf("冲突侧路径为空")
	}
	return fsutil.SafeJoinUnder(root, rel)
}

func readTextSide(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	if bytes.IndexByte(b, 0) >= 0 {
		return "", fmt.Errorf("非文本文件：%s", path)
	}
	if !utf8.Valid(b) {
		return "", fmt.Errorf("非 UTF-8 文本：%s", path)
	}
	return string(b), nil
}

func isTextFile(path string) bool {
	b, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	if bytes.IndexByte(b, 0) >= 0 {
		return false
	}
	return utf8.Valid(b)
}
