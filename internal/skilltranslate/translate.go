// Package skilltranslate creates a translated, self-contained skill copy.
package skilltranslate

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"SkillsManager/internal/fsutil"
)

const chunkLimit = 12_000

var (
	ErrTargetExists = errors.New("目标 skill 已存在")
	// Allow leading indentation so mask() and balancedFences() agree on fenced blocks.
	fencedCodeRE       = regexp.MustCompile("(?ms)^[ \\t]*(?:```|~~~)[^\\n]*\\n.*?^[ \\t]*(?:```|~~~)[ \\t]*$")
	inlineCodeRE       = regexp.MustCompile("`[^`\\r\\n]+`")
	urlRE              = regexp.MustCompile(`https?://[^\s<>()]+`)
	pathRE             = regexp.MustCompile("(?:\\.\\.?[\\\\/][A-Za-z0-9._~%+@/\\\\-]+|[A-Za-z]:[\\\\/][^\\s`'\"<>]+|/[A-Za-z0-9._~%+@-]+(?:/[A-Za-z0-9._~%+@-]+)*)")
	descriptionRE      = regexp.MustCompile(`^(\s*description\s*:\s*)(.*?)(\r?)$`)
	blockScalarStyleRE = regexp.MustCompile(`^([|>])([+-])?([1-9][0-9]*)?\s*$`)
	urlTrailCutset     = ".,;:!?。，；：！？"
)

type Progress struct {
	Phase      string `json:"phase"`
	File       string `json:"file,omitempty"`
	Current    int    `json:"current"`
	Total      int    `json:"total"`
	Chunk      int    `json:"chunk,omitempty"`
	ChunkTotal int    `json:"chunkTotal,omitempty"`
}

type Request struct {
	Source         string
	Target         string
	TargetLanguage string
	Overwrite      bool
	// Translate receives a protected text fragment and must return only its
	// translation. It is intentionally injected to keep filesystem work
	// independent from a particular AI provider.
	Translate func(context.Context, string, string) (string, error)
}

type Result struct {
	Target string
	Files  int
}

// Run snapshots Source into a hidden sibling directory, translates only the
// supported document files, then atomically publishes Target on success.
func Run(ctx context.Context, req Request, report func(Progress)) (Result, error) {
	if req.Translate == nil {
		return Result{}, errors.New("未配置翻译器")
	}
	if report == nil {
		report = func(Progress) {}
	}
	if req.Source == "" || req.Target == "" {
		return Result{}, errors.New("源 skill 或目标 skill 为空")
	}
	if fsutil.SamePath(req.Source, req.Target) {
		return Result{}, errors.New("不能覆盖源 skill")
	}
	if _, err := os.Stat(req.Target); err == nil && !req.Overwrite {
		return Result{}, ErrTargetExists
	} else if err != nil && !os.IsNotExist(err) {
		return Result{}, err
	}

	parent := filepath.Dir(req.Target)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return Result{}, err
	}
	stage, err := os.MkdirTemp(parent, "."+filepath.Base(req.Target)+".__translating-*")
	if err != nil {
		return Result{}, fmt.Errorf("创建翻译临时目录失败：%w", err)
	}
	published := false
	defer func() {
		if !published {
			_ = os.RemoveAll(stage)
		}
	}()

	report(Progress{Phase: "copying"})
	if err := copyTree(ctx, req.Source, stage); err != nil {
		return Result{}, fmt.Errorf("创建 skill 副本失败：%w", err)
	}
	immutable, err := immutableSnapshot(stage)
	if err != nil {
		return Result{}, err
	}
	files, err := translatableFiles(stage)
	if err != nil {
		return Result{}, err
	}
	for index, rel := range files {
		if err := ctx.Err(); err != nil {
			return Result{}, err
		}
		report(Progress{Phase: "translating", File: rel, Current: index + 1, Total: len(files)})
		path := filepath.Join(stage, filepath.FromSlash(rel))
		input, err := os.ReadFile(path)
		if err != nil {
			return Result{}, err
		}
		output, err := translateDocument(ctx, string(input), rel == "SKILL.md", req, func(chunk, chunkTotal int) {
			report(Progress{
				Phase:      "translating",
				File:       rel,
				Current:    index + 1,
				Total:      len(files),
				Chunk:      chunk,
				ChunkTotal: chunkTotal,
			})
		})
		if err != nil {
			return Result{}, fmt.Errorf("翻译 %s 失败：%w", rel, err)
		}
		if err := os.WriteFile(path, []byte(output), 0o644); err != nil {
			return Result{}, err
		}
	}

	report(Progress{Phase: "validating", Current: len(files), Total: len(files)})
	if err := verifyImmutableSnapshot(stage, immutable); err != nil {
		return Result{}, fmt.Errorf("副本完整性校验失败：%w", err)
	}
	if err := validateSkill(filepath.Join(stage, "SKILL.md")); err != nil {
		return Result{}, err
	}
	report(Progress{Phase: "publishing", Current: len(files), Total: len(files)})
	if err := publish(stage, req.Target, req.Overwrite); err != nil {
		return Result{}, err
	}
	published = true
	return Result{Target: req.Target, Files: len(files)}, nil
}

func copyTree(ctx context.Context, source, destination string) error {
	return filepath.WalkDir(source, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if path == source {
			return nil
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, rel)
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		}
		if d.IsDir() {
			return os.MkdirAll(target, info.Mode().Perm())
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode().Perm())
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(out, in)
		closeErr := out.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
}

func translatableFiles(root string) ([]string, error) {
	var files []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() || d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if !isDocument(rel) {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if utf8.Valid(content) {
			files = append(files, rel)
		}
		return nil
	})
	sort.Strings(files)
	return files, err
}

func isDocument(rel string) bool {
	name := filepath.Base(rel)
	switch strings.ToUpper(name) {
	case "README", "CHANGELOG":
		return true
	}
	switch strings.ToLower(filepath.Ext(name)) {
	case ".md", ".markdown", ".txt":
		return true
	default:
		return false
	}
}

func translateDocument(
	ctx context.Context,
	text string,
	isSkillMD bool,
	req Request,
	onChunk func(chunk, chunkTotal int),
) (string, error) {
	front, body, hasFrontmatter := splitFrontmatter(text)
	if hasFrontmatter {
		if isSkillMD {
			var err error
			front, err = translateDescription(ctx, front, req)
			if err != nil {
				return "", err
			}
		}
		// Other frontmatter is metadata, not prose. Preserve it byte-for-byte.
	}
	translated, err := translateText(ctx, body, req, onChunk)
	if err != nil {
		return "", err
	}
	return front + translated, nil
}

func splitFrontmatter(text string) (front, body string, ok bool) {
	withoutBOM := strings.TrimPrefix(text, "\uFEFF")
	if !strings.HasPrefix(withoutBOM, "---\n") && !strings.HasPrefix(withoutBOM, "---\r\n") {
		return "", text, false
	}
	offset := len(text) - len(withoutBOM)
	for index, line := range strings.SplitAfter(withoutBOM, "\n") {
		if index == 0 {
			continue
		}
		if strings.TrimSpace(line) == "---" {
			end := offset + len(strings.Join(strings.SplitAfter(withoutBOM, "\n")[:index+1], ""))
			return text[:end], text[end:], true
		}
	}
	return "", text, false
}

func translateDescription(ctx context.Context, front string, req Request) (string, error) {
	lines := strings.SplitAfter(front, "\n")
	for i, line := range lines {
		lineEnding := ""
		core := strings.TrimSuffix(line, "\n")
		if core != line {
			lineEnding = "\n"
		}
		match := descriptionRE.FindStringSubmatch(core)
		if len(match) == 0 {
			continue
		}
		keyIndent := leadingSpaces(match[1])
		value, quote, consumed := extractDescriptionScalar(match[2], lines, i+1, keyIndent)
		if value == "" {
			return front, nil
		}
		translated, err := translateTextWithInstructions(
			ctx,
			value,
			req,
			nil,
			descriptionTranslationInstruction(req.TargetLanguage),
			descriptionCorrectionInstruction(req.TargetLanguage),
		)
		if err != nil {
			return "", err
		}
		translated = strings.TrimSpace(translated)
		if translated == "" {
			return "", errors.New("description 翻译结果为空")
		}
		if strings.ContainsAny(translated, "\r\n") {
			return "", errors.New("description 翻译结果不能包含换行")
		}
		quote, translated = formatYAMLDescriptionValue(quote, translated)
		replacement := match[1] + quote + translated + quote + match[3] + lineEnding
		out := make([]string, 0, len(lines)-consumed)
		out = append(out, lines[:i]...)
		out = append(out, replacement)
		out = append(out, lines[i+1+consumed:]...)
		return strings.Join(out, ""), nil
	}
	return front, nil
}

// extractDescriptionScalar reads a plain/quoted scalar or a YAML block scalar
// (>, |) that may span following indented lines. Block scalars are collapsed to
// prose before translation; the caller rewrites them as a single YAML line.
func extractDescriptionScalar(inline string, lines []string, next, keyIndent int) (value, quote string, consumed int) {
	inline = strings.TrimSpace(inline)
	if style, ok := parseBlockScalarStyle(inline); ok {
		value, consumed = readBlockScalar(style, lines, next, keyIndent)
		return value, "", consumed
	}
	if inline == "" {
		return "", "", 0
	}
	if len(inline) >= 2 && ((inline[0] == '"' && inline[len(inline)-1] == '"') || (inline[0] == '\'' && inline[len(inline)-1] == '\'')) {
		return inline[1 : len(inline)-1], inline[:1], 0
	}
	return inline, "", 0
}

type blockStyle struct {
	folded         bool
	explicitIndent int // 0 = detect from first content line; else keyIndent + n
}

func parseBlockScalarStyle(s string) (blockStyle, bool) {
	m := blockScalarStyleRE.FindStringSubmatch(s)
	if m == nil {
		return blockStyle{}, false
	}
	st := blockStyle{folded: m[1] == ">"}
	if m[3] != "" {
		for _, c := range m[3] {
			st.explicitIndent = st.explicitIndent*10 + int(c-'0')
		}
	}
	return st, true
}

func readBlockScalar(style blockStyle, lines []string, start, keyIndent int) (string, int) {
	contentIndent := 0
	if style.explicitIndent > 0 {
		contentIndent = keyIndent + style.explicitIndent
	}

	var content []string
	consumed := 0
	for i := start; i < len(lines); i++ {
		raw := strings.TrimSuffix(strings.TrimSuffix(lines[i], "\n"), "\r")
		trimmed := strings.TrimSpace(raw)
		if trimmed == "---" {
			break
		}
		indent := leadingSpaces(raw)
		isBlank := trimmed == ""

		if !isBlank && indent <= keyIndent {
			break
		}
		if !isBlank && contentIndent == 0 {
			contentIndent = indent
		}
		if isBlank {
			content = append(content, "")
		} else if contentIndent > 0 && indent < contentIndent {
			break
		} else if contentIndent > len(raw) {
			content = append(content, "")
		} else {
			content = append(content, raw[contentIndent:])
		}
		consumed++
	}

	return strings.TrimSpace(joinBlockScalar(style.folded, content)), consumed
}

func joinBlockScalar(folded bool, content []string) string {
	if !folded {
		return strings.Join(content, "\n")
	}
	var b strings.Builder
	for _, line := range content {
		if line == "" {
			if b.Len() > 0 && !strings.HasSuffix(b.String(), "\n") {
				b.WriteByte('\n')
			}
			b.WriteByte('\n')
			continue
		}
		if b.Len() > 0 && !strings.HasSuffix(b.String(), "\n") {
			b.WriteByte(' ')
		}
		b.WriteString(line)
	}
	return b.String()
}

func leadingSpaces(s string) int {
	n := 0
	for _, r := range s {
		if r == ' ' || r == '\t' {
			n++
			continue
		}
		break
	}
	return n
}

// formatYAMLDescriptionValue keeps translated description text YAML-safe for the
// quote style used by the source frontmatter (or upgrades to double quotes).
func formatYAMLDescriptionValue(quote, value string) (string, string) {
	if quote == "" && needsYAMLDoubleQuote(value) {
		quote = `"`
	}
	switch quote {
	case `"`:
		value = strings.ReplaceAll(value, `\`, `\\`)
		value = strings.ReplaceAll(value, `"`, `\"`)
	case `'`:
		value = strings.ReplaceAll(value, `'`, `''`)
	}
	return quote, value
}

func needsYAMLDoubleQuote(value string) bool {
	if value == "" {
		return false
	}
	if strings.ContainsAny(value, "\"'#:{}[]&*!|>%@`") {
		return true
	}
	if strings.HasPrefix(value, " ") || strings.HasSuffix(value, " ") {
		return true
	}
	return strings.Contains(value, " #")
}

func translateText(ctx context.Context, text string, req Request, onChunk func(chunk, chunkTotal int)) (string, error) {
	return translateTextWithInstructions(
		ctx,
		text,
		req,
		onChunk,
		translationInstruction(req.TargetLanguage),
		correctionInstruction(req.TargetLanguage),
	)
}

func translateTextWithInstructions(
	ctx context.Context,
	text string,
	req Request,
	onChunk func(chunk, chunkTotal int),
	instruction string,
	correction string,
) (string, error) {
	if text == "" {
		return text, nil
	}
	masked, protected, err := mask(text)
	if err != nil {
		return "", err
	}
	chunks, err := splitChunks(masked)
	if err != nil {
		return "", err
	}
	var translated strings.Builder
	for i, chunk := range chunks {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		if onChunk != nil {
			onChunk(i+1, len(chunks))
		}
		indexes := protectedIndexes(chunk, protected)
		result, err := req.Translate(ctx, instruction, chunk)
		if err != nil {
			return "", err
		}
		restored, restoreErr := unmaskSelected(result, protected, indexes)
		if restoreErr != nil {
			result, err = req.Translate(ctx, correction, chunk)
			if err != nil {
				return "", err
			}
			restored, restoreErr = unmaskSelected(result, protected, indexes)
			if restoreErr != nil {
				return "", restoreErr
			}
		}
		translated.WriteString(restored)
	}
	return translated.String(), nil
}

func translationInstruction(language string) string {
	return fmt.Sprintf(`Translate the provided skill documentation into %s.

Output requirements:
- Return only the translated document. Do not add commentary or wrap it in a Markdown fence.
- Preserve the original Markdown structure, spacing, lists, headings, and line breaks.
- Translate natural-language prose and ordinary headings accurately and naturally.
- Keep commands, paths, URLs, package/tool/API identifiers, behavior-critical labels, and code unchanged.
- Every [[SM_PROTECTED_0000]]-style token is immutable: return each token exactly once, character-for-character, in its original position.`, language)
}

func correctionInstruction(language string) string {
	return fmt.Sprintf(`Translate the provided text into %s and return only the translation, with no commentary or Markdown fence. Every [[SM_PROTECTED_0000]]-style token is immutable and must appear exactly once, character-for-character, in its original position.`, language)
}

func descriptionTranslationInstruction(language string) string {
	return fmt.Sprintf(`Translate the provided YAML frontmatter skill description into %s.

Output contract:
- Return only the translated description as exactly one line of plain text.
- Do not output line breaks, YAML keys, quotes, bullets, prefixes, commentary, or Markdown fences.
- Keep the meaning concise and natural; do not expand the description.
- Preserve commands, paths, URLs, package/tool/API identifiers, and behavior-critical labels.
- Every [[SM_PROTECTED_0000]]-style token is immutable: return each token exactly once and character-for-character.`, language)
}

func descriptionCorrectionInstruction(language string) string {
	return fmt.Sprintf(`Translate the provided skill description into %s. Return only the translation as exactly one line of plain text: no line breaks, YAML, quotes, bullets, commentary, or Markdown fences. Every [[SM_PROTECTED_0000]]-style token must appear exactly once and unchanged.`, language)
}

func mask(text string) (string, []string, error) {
	if strings.Contains(text, "[[SM_PROTECTED_") {
		return "", nil, errors.New("文本包含保留占位符前缀，无法安全翻译")
	}
	protected := make([]string, 0)
	protect := func(match string) string {
		token := fmt.Sprintf("[[SM_PROTECTED_%04d]]", len(protected))
		protected = append(protected, match)
		return token
	}
	text = fencedCodeRE.ReplaceAllStringFunc(text, protect)
	text = inlineCodeRE.ReplaceAllStringFunc(text, protect)
	text = urlRE.ReplaceAllStringFunc(text, func(match string) string {
		url := strings.TrimRight(match, urlTrailCutset)
		if url == "" || url == match {
			if url == "" {
				return match
			}
			return protect(match)
		}
		return protect(url) + match[len(url):]
	})
	text = pathRE.ReplaceAllStringFunc(text, func(match string) string {
		if isNumericAbsolutePath(match) {
			return match
		}
		return protect(match)
	})
	return text, protected, nil
}

// isNumericAbsolutePath reports fraction-like matches such as "/4" from "3/4"
// that must not be treated as filesystem paths.
func isNumericAbsolutePath(match string) bool {
	if !strings.HasPrefix(match, "/") {
		return false
	}
	for _, seg := range strings.Split(strings.TrimPrefix(match, "/"), "/") {
		if seg == "" {
			return false
		}
		for _, r := range seg {
			if r < '0' || r > '9' {
				return false
			}
		}
	}
	return true
}

func protectedIndexes(text string, protected []string) []int {
	indexes := make([]int, 0)
	for index := range protected {
		token := fmt.Sprintf("[[SM_PROTECTED_%04d]]", index)
		if strings.Contains(text, token) {
			indexes = append(indexes, index)
		}
	}
	return indexes
}

func unmaskSelected(text string, protected []string, indexes []int) (string, error) {
	for _, index := range indexes {
		token := fmt.Sprintf("[[SM_PROTECTED_%04d]]", index)
		if strings.Count(text, token) != 1 {
			return "", fmt.Errorf("受保护内容 %d 未被完整保留", index+1)
		}
		text = strings.Replace(text, token, protected[index], 1)
	}
	if strings.Contains(text, "[[SM_PROTECTED_") {
		return "", errors.New("出现未知受保护占位符")
	}
	return text, nil
}

func splitChunks(text string) ([]string, error) {
	if text == "" {
		return []string{""}, nil
	}
	if utf8.RuneCountInString(text) <= chunkLimit {
		return []string{text}, nil
	}
	return packUnits(splitUnits(text, chunkLimit), chunkLimit), nil
}

// splitUnits breaks oversized text with a cascading strategy so translation can
// continue: blank-line paragraphs, then lines, then sentence ends, then a
// protected-token-safe hard cut.
func splitUnits(text string, limit int) []string {
	return splitBySeparator(text, "\n\n", limit, func(paragraph string) []string {
		return splitBySeparator(paragraph, "\n", limit, func(line string) []string {
			return splitBySentenceOrRunes(line, limit)
		})
	})
}

func splitBySeparator(text, separator string, limit int, oversized func(string) []string) []string {
	parts := strings.SplitAfter(text, separator)
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			continue
		}
		if utf8.RuneCountInString(part) <= limit {
			out = append(out, part)
			continue
		}
		out = append(out, oversized(part)...)
	}
	return out
}

func splitBySentenceOrRunes(text string, limit int) []string {
	if utf8.RuneCountInString(text) <= limit {
		return []string{text}
	}
	runes := []rune(text)
	out := make([]string, 0, (len(runes)/limit)+1)
	for len(runes) > limit {
		cut := softCutIndex(runes, limit)
		out = append(out, string(runes[:cut]))
		runes = runes[cut:]
	}
	if len(runes) > 0 {
		out = append(out, string(runes))
	}
	return out
}

func softCutIndex(runes []rune, limit int) int {
	if len(runes) <= limit {
		return len(runes)
	}
	cut := limit
	for i := limit - 1; i >= limit/2; i-- {
		switch runes[i] {
		case '。', '！', '？', '.', '!', '?':
			if i+1 == len(runes) || runes[i+1] == ' ' || runes[i+1] == '\t' || runes[i+1] == '\n' || runes[i+1] == '\r' {
				cut = i + 1
				if cut < len(runes) && (runes[cut] == ' ' || runes[cut] == '\t') {
					cut++
				}
				return adjustCutAroundProtectedToken(runes, cut)
			}
		}
	}
	return adjustCutAroundProtectedToken(runes, cut)
}

func adjustCutAroundProtectedToken(runes []rune, cut int) int {
	if cut <= 0 || cut >= len(runes) {
		if cut <= 0 {
			return 1
		}
		return cut
	}
	prefix := string(runes[:cut])
	start := strings.LastIndex(prefix, "[[SM_PROTECTED_")
	if start < 0 {
		return cut
	}
	if strings.Contains(prefix[start:], "]]") {
		return cut
	}
	before := utf8.RuneCountInString(prefix[:start])
	if before > 0 {
		return before
	}
	full := string(runes)
	end := strings.Index(full, "]]")
	if end < 0 {
		return cut
	}
	return utf8.RuneCountInString(full[:end+2])
}

func packUnits(units []string, limit int) []string {
	if len(units) == 0 {
		return []string{""}
	}
	chunks := make([]string, 0, len(units))
	var current strings.Builder
	currentRunes := 0
	for _, unit := range units {
		unitRunes := utf8.RuneCountInString(unit)
		if current.Len() > 0 && currentRunes+unitRunes > limit {
			chunks = append(chunks, current.String())
			current.Reset()
			currentRunes = 0
		}
		current.WriteString(unit)
		currentRunes += unitRunes
	}
	if current.Len() > 0 {
		chunks = append(chunks, current.String())
	}
	return chunks
}

type immutableFile struct {
	mode       fs.FileMode
	linkTarget string
	hash       [sha256.Size]byte
}

func immutableSnapshot(root string) (map[string]immutableFile, error) {
	entries := make(map[string]immutableFile)
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root || d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		relSlash := filepath.ToSlash(rel)
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		entry := immutableFile{mode: info.Mode()}
		if info.Mode()&os.ModeSymlink != 0 {
			entry.linkTarget, err = os.Readlink(path)
			if err != nil {
				return err
			}
			entries[relSlash] = entry
			return nil
		}
		if isDocument(relSlash) {
			content, err := os.ReadFile(path)
			if err == nil && utf8.Valid(content) {
				return nil
			}
		}
		entry.hash, err = hashFile(path)
		if err != nil {
			return err
		}
		entries[relSlash] = entry
		return nil
	})
	return entries, err
}

func verifyImmutableSnapshot(root string, expected map[string]immutableFile) error {
	actual, err := immutableSnapshot(root)
	if err != nil {
		return err
	}
	if len(actual) != len(expected) {
		return errors.New("非文档文件清单发生变化")
	}
	for path, entry := range expected {
		got, ok := actual[path]
		if !ok {
			return fmt.Errorf("非文档文件缺失：%s", path)
		}
		if entry.mode != got.mode || entry.linkTarget != got.linkTarget || entry.hash != got.hash {
			return fmt.Errorf("非文档文件变化：%s", path)
		}
	}
	return nil
}

func validateSkill(path string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("副本缺少 SKILL.md：%w", err)
	}
	_, body, hasFrontmatter := splitFrontmatter(string(content))
	if !hasFrontmatter {
		body = string(content)
	}
	if !balancedFences(body) {
		return errors.New("Markdown 代码围栏不匹配")
	}
	return nil
}

func balancedFences(text string) bool {
	open := byte(0)
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimLeft(line, " \t")
		if len(trimmed) < 3 || (trimmed[0] != '`' && trimmed[0] != '~') {
			continue
		}
		if trimmed[1] != trimmed[0] || trimmed[2] != trimmed[0] {
			continue
		}
		if open == 0 {
			open = trimmed[0]
		} else if open == trimmed[0] {
			open = 0
		}
	}
	return open == 0
}

func publish(stage, target string, overwrite bool) error {
	if _, err := os.Stat(target); err == nil {
		if !overwrite {
			return ErrTargetExists
		}
		backup, err := os.MkdirTemp(filepath.Dir(target), "."+filepath.Base(target)+".__backup-*")
		if err != nil {
			return err
		}
		if err := os.Remove(backup); err != nil {
			return err
		}
		if err := os.Rename(target, backup); err != nil {
			return err
		}
		if err := os.Rename(stage, target); err != nil {
			_ = os.Rename(backup, target)
			return err
		}
		return os.RemoveAll(backup)
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.Rename(stage, target)
}

func hashFile(path string) ([sha256.Size]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return [sha256.Size]byte{}, err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return [sha256.Size]byte{}, err
	}
	var result [sha256.Size]byte
	copy(result[:], hash.Sum(nil))
	return result, nil
}
