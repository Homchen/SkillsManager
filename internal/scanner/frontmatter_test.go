package scanner

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseFrontmatterIgnoresBodyExamples(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "SKILL.md")
	content := `---
name: writing-skills
description: Use when creating new skills
---

# Writing Skills

Example template in the body:

` + "```markdown" + `
---
name: Skill-Name-With-Hyphens
description: Use when [specific triggering conditions and symptoms]
---
` + "```" + `
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	name, desc := parseFrontmatter(path)
	if name != "writing-skills" {
		t.Fatalf("name=%q want writing-skills", name)
	}
	if desc != "Use when creating new skills" {
		t.Fatalf("description=%q", desc)
	}
}

func TestParseFrontmatterMissingFence(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "SKILL.md")
	if err := os.WriteFile(path, []byte("name: only-body\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	name, desc := parseFrontmatter(path)
	if name != "" || desc != "" {
		t.Fatalf("expected empty without frontmatter fence, got name=%q desc=%q", name, desc)
	}
}

func TestParseFrontmatterStripsUTF8BOM(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "SKILL.md")
	content := "\uFEFF---\nname: rdbms-cli\ndescription: RDBMS 数据库操作\n---\n\n# Body\n"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	name, desc := parseFrontmatter(path)
	if name != "rdbms-cli" {
		t.Fatalf("name=%q want rdbms-cli", name)
	}
	if desc != "RDBMS 数据库操作" {
		t.Fatalf("description=%q", desc)
	}
}

func TestParseFrontmatterFoldedDescription(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "SKILL.md")
	content := `---
name: folded-skill
description: >
  First line of the description
  continues on the next line.
name-ignored: no
---

# Body
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	name, desc := parseFrontmatter(path)
	if name != "folded-skill" {
		t.Fatalf("name=%q", name)
	}
	want := "First line of the description continues on the next line."
	if desc != want {
		t.Fatalf("description=%q want %q", desc, want)
	}
}

func TestParseFrontmatterLiteralDescription(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "SKILL.md")
	content := "---\nname: literal-skill\ndescription: |\n  Line one\n  Line two\n---\n\n# Body\n"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	_, desc := parseFrontmatter(path)
	want := "Line one\nLine two"
	if desc != want {
		t.Fatalf("description=%q want %q", desc, want)
	}
}

func TestParseFrontmatterFoldedDescriptionStopsAtNextKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "SKILL.md")
	content := `---
description: >
  alpha
  beta
name: after-desc
---
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	name, desc := parseFrontmatter(path)
	if name != "after-desc" {
		t.Fatalf("name=%q", name)
	}
	if desc != "alpha beta" {
		t.Fatalf("description=%q", desc)
	}
}
