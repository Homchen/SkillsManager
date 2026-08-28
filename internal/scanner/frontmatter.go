package scanner

import (
	"bufio"
	"bytes"
	"os"
	"regexp"
	"strings"
)

const frontmatterReadLimit = 4096

var (
	frontmatterKeyRE   = regexp.MustCompile(`^(\s*)([A-Za-z0-9_-]+):\s*(.*)$`)
	blockScalarStyleRE = regexp.MustCompile(`^([|>])([+-])?([1-9][0-9]*)?\s*$`)
)

// parseFrontmatter reads the first 4KB of SKILL.md and extracts name/description
// from the opening YAML frontmatter fence only (between the first pair of ---).
// Body examples that also contain "name:" / "description:" lines are ignored.
// Supports plain, quoted, and block scalar (>, |, with optional chomping) values.
func parseFrontmatter(skillMDPath string) (name, description string) {
	f, err := os.Open(skillMDPath)
	if err != nil {
		return "", ""
	}
	defer f.Close()

	buf := make([]byte, frontmatterReadLimit)
	n, _ := f.Read(buf)
	buf = buf[:n]
	buf = bytes.TrimPrefix(buf, []byte{0xEF, 0xBB, 0xBF})

	var lines []string
	scanner := bufio.NewScanner(bytes.NewReader(buf))
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}

	inFence := false
	for i := 0; i < len(lines); i++ {
		raw := lines[i]
		trimmed := strings.TrimSpace(raw)
		if trimmed == "---" {
			if !inFence {
				inFence = true
				continue
			}
			break
		}
		if !inFence {
			continue
		}

		key, inline, keyIndent, ok := matchFrontmatterKey(raw)
		if !ok {
			continue
		}
		value, consumed := parseYAMLScalar(inline, lines, i+1, keyIndent)
		i += consumed
		switch key {
		case "name":
			name = value
		case "description":
			description = value
		}
	}
	return name, description
}

func matchFrontmatterKey(raw string) (key, inline string, keyIndent int, ok bool) {
	m := frontmatterKeyRE.FindStringSubmatch(raw)
	if m == nil {
		return "", "", 0, false
	}
	return m[2], m[3], len(m[1]), true
}

func parseYAMLScalar(inline string, lines []string, next, keyIndent int) (string, int) {
	inline = strings.TrimSpace(inline)
	if style, ok := parseBlockScalarStyle(inline); ok {
		return readBlockScalar(style, lines, next, keyIndent)
	}
	return unquoteYAMLScalar(inline), 0
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
		raw := lines[i]
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
		} else {
			if contentIndent > len(raw) {
				content = append(content, "")
			} else {
				content = append(content, raw[contentIndent:])
			}
		}
		consumed++
	}

	text := joinBlockScalar(style.folded, content)
	// Skill metadata is shown as prose; strip surrounding whitespace for display.
	return strings.TrimSpace(text), consumed
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

func unquoteYAMLScalar(s string) string {
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}
