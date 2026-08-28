package skilltranslate

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTranslateDocumentIssuesDescriptionThenBodyCalls(t *testing.T) {
	text := `---
name: code-modernization
description: Structured legacy modernization — preflight through brief.
---

# code-modernization

Port of Anthropic's plugin.
`
	var calls []string
	got, err := translateDocument(context.Background(), text, true, Request{
		TargetLanguage: "zh-CN",
		Translate: func(_ context.Context, instruction, chunk string) (string, error) {
			kind := "body"
			if strings.Contains(instruction, "YAML frontmatter") {
				kind = "description"
			}
			calls = append(calls, kind)
			return chunk, nil
		},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "description: Structured legacy modernization") {
		t.Fatalf("frontmatter lost:\n%s", got)
	}
	if len(calls) != 2 || calls[0] != "description" || calls[1] != "body" {
		t.Fatalf("calls=%v want [description body]", calls)
	}
}

func TestRunCreatesTranslatedCopyAndPreservesProtectedContent(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	target := filepath.Join(root, "source-zh-CN")
	mustWrite(t, filepath.Join(source, "SKILL.md"), `---
name: original-skill
description: Install the package safely
---

# Installation

Run `+"`npm install example`"+` and visit https://example.com/docs.

`+"```sh"+`
example --config ./config.json
`+"```"+`
`)
	mustWrite(t, filepath.Join(source, "README"), "Read this document.\n")
	mustWrite(t, filepath.Join(source, "scripts", "run.sh"), "#!/bin/sh\necho unchanged\n")

	result, err := Run(context.Background(), Request{
		Source:         source,
		Target:         target,
		TargetLanguage: "zh-CN",
		Translate: func(_ context.Context, _ string, text string) (string, error) {
			replacer := strings.NewReplacer(
				"Installation", "安装说明",
				"Install", "安装",
				"Run", "运行",
				"Read this document.", "阅读此文档。",
				"safely", "安全地",
			)
			return replacer.Replace(text), nil
		},
	}, nil)
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if result.Files != 2 {
		t.Fatalf("translated files = %d, want 2", result.Files)
	}
	skill := mustRead(t, filepath.Join(target, "SKILL.md"))
	for _, want := range []string{
		"name: original-skill",
		"description: 安装 the package 安全地",
		"# 安装说明",
		"`npm install example`",
		"https://example.com/docs",
		"example --config ./config.json",
	} {
		if !strings.Contains(skill, want) {
			t.Errorf("translated SKILL.md missing %q:\n%s", want, skill)
		}
	}
	if got := mustRead(t, filepath.Join(target, "scripts", "run.sh")); got != "#!/bin/sh\necho unchanged\n" {
		t.Errorf("non-document file changed: %q", got)
	}
}

func TestRunRetriesWhenProtectedTokenIsChanged(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	target := filepath.Join(root, "source-zh-CN")
	mustWrite(t, filepath.Join(source, "SKILL.md"), "---\nname: source\n---\n\nUse `command`.\n")

	calls := 0
	_, err := Run(context.Background(), Request{
		Source:         source,
		Target:         target,
		TargetLanguage: "zh-CN",
		Translate: func(_ context.Context, _ string, text string) (string, error) {
			calls++
			if calls == 1 {
				return strings.Replace(text, "[[SM_PROTECTED_0000]]", "changed", 1), nil
			}
			return text, nil
		},
	}, nil)
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if calls != 2 {
		t.Fatalf("translation calls = %d, want 2", calls)
	}
	if got := mustRead(t, filepath.Join(target, "SKILL.md")); !strings.Contains(got, "`command`") {
		t.Fatalf("protected content was not restored: %s", got)
	}
}

func TestRunDoesNotReplaceExistingTargetWithoutOverwrite(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	target := filepath.Join(root, "source-zh-CN")
	mustWrite(t, filepath.Join(source, "SKILL.md"), "---\nname: source\n---\n\nText\n")
	mustWrite(t, filepath.Join(target, "SKILL.md"), "---\nname: old\n---\n\nOld\n")

	_, err := Run(context.Background(), Request{
		Source: source,
		Target: target,
		Translate: func(_ context.Context, _ string, text string) (string, error) {
			return text, nil
		},
	}, nil)
	if !errors.Is(err, ErrTargetExists) {
		t.Fatalf("Run() error = %v, want ErrTargetExists", err)
	}
	if got := mustRead(t, filepath.Join(target, "SKILL.md")); !strings.Contains(got, "name: old") {
		t.Fatalf("existing target was changed: %s", got)
	}
}

func TestSplitChunksFallsBackBeyondParagraphs(t *testing.T) {
	line := strings.Repeat("word ", 3000) // ~15000 runes, no blank lines
	chunks, err := splitChunks(line)
	if err != nil {
		t.Fatalf("splitChunks() error = %v", err)
	}
	if len(chunks) < 2 {
		t.Fatalf("expected multiple chunks, got %d", len(chunks))
	}
	joined := strings.Join(chunks, "")
	if joined != line {
		t.Fatalf("chunks do not reassemble original text")
	}
	for i, chunk := range chunks {
		if n := utf8.RuneCountInString(chunk); n > chunkLimit {
			t.Fatalf("chunk %d has %d runes, limit %d", i, n, chunkLimit)
		}
	}
}

func TestMaskDoesNotProtectNumericFractionPaths(t *testing.T) {
	masked, protected, err := mask("About 3/4 of users prefer this.")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(masked, "[[SM_PROTECTED_") {
		t.Fatalf("fraction was masked: masked=%q protected=%v", masked, protected)
	}
	if masked != "About 3/4 of users prefer this." {
		t.Fatalf("masked=%q", masked)
	}
}

func TestMaskStripsTrailingPunctuationFromURLs(t *testing.T) {
	masked, protected, err := mask("See https://example.com/docs.")
	if err != nil {
		t.Fatal(err)
	}
	if len(protected) != 1 || protected[0] != "https://example.com/docs" {
		t.Fatalf("protected=%v", protected)
	}
	if !strings.HasSuffix(masked, ".") {
		t.Fatalf("trailing period was not preserved outside URL: %q", masked)
	}
}

func TestMaskProtectsIndentedFencedCode(t *testing.T) {
	text := "Intro\n\n   ```sh\n   npm install\n   ```\n\nOutro"
	masked, protected, err := mask(text)
	if err != nil {
		t.Fatal(err)
	}
	if len(protected) != 1 || !strings.Contains(protected[0], "npm install") {
		t.Fatalf("indented fence not protected: protected=%v masked=%q", protected, masked)
	}
	if strings.Contains(masked, "npm install") {
		t.Fatalf("code leaked into masked text: %q", masked)
	}
}

func TestTranslateDescriptionEscapesQuotesInYAML(t *testing.T) {
	front := "---\nname: demo\ndescription: \"Say hello\"\n---\n"
	out, err := translateDescription(context.Background(), front, Request{
		TargetLanguage: "zh-CN",
		Translate: func(_ context.Context, _, text string) (string, error) {
			return `他说"你好"`, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "---\nname: demo\ndescription: \"他说\\\"你好\\\"\"\n---\n"
	if out != want {
		t.Fatalf("out=%q want %q", out, want)
	}
}

func TestTranslateDescriptionTrimsModelPadding(t *testing.T) {
	front := "---\nname: demo\ndescription: Hello\n---\n"
	out, err := translateDescription(context.Background(), front, Request{
		TargetLanguage: "zh-CN",
		Translate: func(_ context.Context, _, text string) (string, error) {
			return "  你好\n", nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "description: 你好\n") {
		t.Fatalf("unexpected frontmatter: %q", out)
	}
}

func TestTranslateDescriptionRequestsSingleLineOutput(t *testing.T) {
	front := "---\nname: demo\ndescription: Translate skill documentation\n---\n"
	out, err := translateDescription(context.Background(), front, Request{
		TargetLanguage: "zh-CN",
		Translate: func(_ context.Context, instruction, _ string) (string, error) {
			if !strings.Contains(instruction, "exactly one line") {
				return "翻译技能\n文档", nil
			}
			return "翻译技能文档", nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "description: 翻译技能文档\n") {
		t.Fatalf("unexpected frontmatter: %q", out)
	}
}

func TestTranslateDescriptionFoldedBlockScalar(t *testing.T) {
	front := `---
name: open-code-review-delegate
description: >
  Delegation mode for open-code-review (OCR). Instead of OCR calling an LLM
  endpoint, this skill instructs the host agent to perform the code review
  itself.
license: Apache-2.0
---
`
	var gotSource string
	out, err := translateDescription(context.Background(), front, Request{
		TargetLanguage: "zh-CN",
		Translate: func(_ context.Context, _, text string) (string, error) {
			gotSource = text
			return "OCR 委派模式：由宿主代理完成审查，OCR 仅做文件选择与规则解析。", nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	wantSource := "Delegation mode for open-code-review (OCR). Instead of OCR calling an LLM endpoint, this skill instructs the host agent to perform the code review itself."
	if gotSource != wantSource {
		t.Fatalf("translated source=%q want %q", gotSource, wantSource)
	}
	if strings.Contains(out, "description: >") {
		t.Fatalf("block marker should be collapsed to a single line:\n%s", out)
	}
	if strings.Contains(out, "Delegation mode") || strings.Contains(out, "endpoint, this skill") {
		t.Fatalf("source block content should be removed:\n%s", out)
	}
	if !strings.Contains(out, "description: OCR 委派模式：由宿主代理完成审查，OCR 仅做文件选择与规则解析。\n") {
		t.Fatalf("unexpected frontmatter:\n%s", out)
	}
	if !strings.Contains(out, "license: Apache-2.0\n") {
		t.Fatalf("following keys should be preserved:\n%s", out)
	}
}

func TestTranslateDescriptionLiteralBlockScalar(t *testing.T) {
	front := "---\nname: demo\ndescription: |\n  Line one\n  Line two\n---\n"
	var gotSource string
	out, err := translateDescription(context.Background(), front, Request{
		TargetLanguage: "zh-CN",
		Translate: func(_ context.Context, _, text string) (string, error) {
			gotSource = text
			return "第一行 第二行", nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotSource != "Line one\nLine two" {
		t.Fatalf("translated source=%q", gotSource)
	}
	if strings.Contains(out, "description: |") || strings.Contains(out, "Line one") {
		t.Fatalf("literal block should be replaced:\n%s", out)
	}
	if !strings.Contains(out, "description: 第一行 第二行\n") {
		t.Fatalf("unexpected frontmatter:\n%s", out)
	}
}

func TestTranslateDescriptionEmptyFoldedBlockLeavesFrontmatter(t *testing.T) {
	front := "---\nname: demo\ndescription: >\nlicense: MIT\n---\n"
	calls := 0
	out, err := translateDescription(context.Background(), front, Request{
		TargetLanguage: "zh-CN",
		Translate: func(_ context.Context, _, text string) (string, error) {
			calls++
			return text, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Fatalf("empty block should not call translator, calls=%d", calls)
	}
	if out != front {
		t.Fatalf("frontmatter changed: %q", out)
	}
}

func TestSplitChunksDoesNotCutProtectedToken(t *testing.T) {
	token := "[[SM_PROTECTED_0000]]"
	prefix := strings.Repeat("a", chunkLimit-5)
	text := prefix + token + strings.Repeat("b", 100)
	chunks, err := splitChunks(text)
	if err != nil {
		t.Fatalf("splitChunks() error = %v", err)
	}
	joined := strings.Join(chunks, "")
	if joined != text {
		t.Fatalf("chunks do not reassemble original text")
	}
	for i, chunk := range chunks {
		if strings.Contains(chunk, "[[SM_PROTECTED_") && !strings.Contains(chunk, "]]") {
			t.Fatalf("chunk %d cuts through protected token: %q", i, chunk)
		}
	}
}

func TestRunTranslatesOversizedParagraph(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	target := filepath.Join(root, "source-zh-CN")
	body := strings.Repeat("Please install carefully. ", 800)
	mustWrite(t, filepath.Join(source, "SKILL.md"), "---\nname: source\n---\n\n"+body)

	calls := 0
	_, err := Run(context.Background(), Request{
		Source:         source,
		Target:         target,
		TargetLanguage: "zh-CN",
		Translate: func(_ context.Context, _ string, text string) (string, error) {
			calls++
			return strings.ReplaceAll(text, "Please install carefully.", "请谨慎安装。"), nil
		},
	}, nil)
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if calls < 2 {
		t.Fatalf("expected chunked translation calls, got %d", calls)
	}
	got := mustRead(t, filepath.Join(target, "SKILL.md"))
	if !strings.Contains(got, "请谨慎安装。") {
		t.Fatalf("translated body missing expected text")
	}
	if strings.Contains(got, "Please install carefully.") {
		t.Fatalf("source sentence still present after translation")
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mustRead(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}
