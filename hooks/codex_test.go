package hooks_test

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type codexHookGroup struct {
	Matcher string `json:"matcher"`
	Hooks   []struct {
		Type    string `json:"type"`
		Command string `json:"command"`
		Timeout int    `json:"timeout"`
	} `json:"hooks"`
}

func TestInstallCodexAgentPreservesExistingHooks(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("install.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	codexDir := filepath.Join(home, ".codex")
	if err := os.MkdirAll(codexDir, 0o755); err != nil {
		t.Fatal(err)
	}
	existing := []byte(`{
  "metadata": "keep-me",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \".codex/hooks/user-audit.cjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
`)
	if err := os.WriteFile(filepath.Join(codexDir, "hooks.json"), existing, 0o644); err != nil {
		t.Fatal(err)
	}

	runCodexInstall(t, repoRoot(t), home)

	raw, err := os.ReadFile(filepath.Join(codexDir, "hooks.json"))
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Metadata string                      `json:"metadata"`
		Hooks    map[string][]codexHookGroup `json:"hooks"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatalf("parse hooks.json: %v\n%s", err, raw)
	}
	if config.Metadata != "keep-me" {
		t.Fatalf("non-hook config was not preserved: %s", raw)
	}
	if !containsCodexCommand(config.Hooks["PreToolUse"], `node ".codex/hooks/user-audit.cjs"`) {
		t.Fatalf("user hook was not preserved: %s", raw)
	}
	assertManagedCodexHook(t, config.Hooks, "PreToolUse", "Read|Skill|Bash|shell_command|mcp__.*read.*", home, raw)
	assertManagedCodexHook(t, config.Hooks, "UserPromptSubmit", "", home, raw)
}

func TestInstallCodexAgentIsIdempotent(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("install.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	root := repoRoot(t)
	runCodexInstall(t, root, home)
	runCodexInstall(t, root, home)

	raw, err := os.ReadFile(filepath.Join(home, ".codex", "hooks.json"))
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Hooks map[string][]codexHookGroup `json:"hooks"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatalf("parse hooks.json: %v\n%s", err, raw)
	}
	wantCommand := managedCodexCommand(home)
	for _, event := range []string{"PreToolUse", "UserPromptSubmit"} {
		count := 0
		for _, group := range config.Hooks[event] {
			for _, hook := range group.Hooks {
				if hook.Command == wantCommand {
					count++
				}
			}
		}
		if count != 1 {
			t.Fatalf("expected one managed %s hook, got %d: %s", event, count, raw)
		}
	}
}

func TestUninstallCodexAgentRemovesOnlyManagedHooks(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("uninstall.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	codexDir := filepath.Join(home, ".codex")
	if err := os.MkdirAll(codexDir, 0o755); err != nil {
		t.Fatal(err)
	}
	existing := []byte(`{
  "metadata": "keep-me",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \".codex/hooks/user-audit.cjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
`)
	if err := os.WriteFile(filepath.Join(codexDir, "hooks.json"), existing, 0o644); err != nil {
		t.Fatal(err)
	}

	root := repoRoot(t)
	runCodexInstall(t, root, home)
	runCodexUninstall(t, root, home)

	managedScript := filepath.Join(home, ".codex", "hooks", "skillsmanager", "codex", "record-skill-read.cjs")
	if _, err := os.Stat(managedScript); !os.IsNotExist(err) {
		t.Fatalf("managed script should be removed, err=%v", err)
	}

	raw, err := os.ReadFile(filepath.Join(codexDir, "hooks.json"))
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Metadata string                      `json:"metadata"`
		Hooks    map[string][]codexHookGroup `json:"hooks"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatalf("parse hooks.json: %v\n%s", err, raw)
	}
	if config.Metadata != "keep-me" {
		t.Fatalf("non-hook config should remain: %s", raw)
	}
	if !containsCodexCommand(config.Hooks["PreToolUse"], `node ".codex/hooks/user-audit.cjs"`) {
		t.Fatalf("user hook should remain: %s", raw)
	}
	for event, groups := range config.Hooks {
		for _, group := range groups {
			for _, hook := range group.Hooks {
				if strings.Contains(hook.Command, "hooks/skillsmanager/codex") {
					t.Fatalf("managed %s hook should be removed: %s", event, raw)
				}
			}
		}
	}

	stateRaw, err := os.ReadFile(filepath.Join(home, ".skillsmanager", "hooks-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	var state struct {
		Agents []string `json:"agents"`
	}
	if err := json.Unmarshal(stateRaw, &state); err != nil {
		t.Fatal(err)
	}
	if containsString(state.Agents, "codex") {
		t.Fatalf("state should not retain codex: %s", stateRaw)
	}
}

func TestRecordCodexSkillReadFromUserPromptSubmit(t *testing.T) {
	home := t.TempDir()
	payload, err := json.Marshal(map[string]any{
		"hook_event_name": "UserPromptSubmit",
		"prompt":          "please /fixture-skill",
	})
	if err != nil {
		t.Fatal(err)
	}

	out := runCodexHook(t, home, payload)
	if strings.TrimSpace(string(out)) != "" {
		t.Fatalf("expected empty hook stdout, got: %s", out)
	}

	usage := loadCodexUsage(t, home)
	if usage.Skills["fixture-skill"].Count != 1 || usage.Skills["fixture-skill"].LastSource != "codex" {
		t.Fatalf("expected slash skill usage from Codex, got %#v", usage.Skills)
	}
}

func TestRecordCodexSkillReadFromDollarSkill(t *testing.T) {
	home := t.TempDir()
	payload, err := json.Marshal(map[string]any{
		"hook_event_name": "UserPromptSubmit",
		"prompt":          "please $fixture-skill now",
	})
	if err != nil {
		t.Fatal(err)
	}
	runCodexHook(t, home, payload)
	usage := loadCodexUsage(t, home)
	if usage.Skills["fixture-skill"].Count != 1 {
		t.Fatalf("expected $skill usage from Codex, got %#v", usage.Skills)
	}
}

func TestRecordCodexSkillReadIgnoresUnixPath(t *testing.T) {
	home := t.TempDir()
	payload, err := json.Marshal(map[string]any{
		"hook_event_name": "UserPromptSubmit",
		"prompt":          "run /usr/bin/python script.py",
	})
	if err != nil {
		t.Fatal(err)
	}
	runCodexHook(t, home, payload)
	usagePath := filepath.Join(home, ".skillsmanager", "skills", "skill-usage.json")
	if _, err := os.Stat(usagePath); !os.IsNotExist(err) {
		usage := loadCodexUsage(t, home)
		if _, ok := usage.Skills["usr"]; ok {
			t.Fatalf("/usr/bin must not be recorded as a skill, got %#v", usage.Skills)
		}
	}
}

func TestRecordCodexSkillReadFromBashSkillPath(t *testing.T) {
	home := t.TempDir()
	skillPath := filepath.Join(home, ".skillsmanager", "skills", "fixture-skill", "SKILL.md")
	payload, err := json.Marshal(map[string]any{
		"hook_event_name": "PreToolUse",
		"tool_name":       "Bash",
		"tool_input": map[string]string{
			"command": `Get-Content "` + skillPath + `"`,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	runCodexHook(t, home, payload)
	usage := loadCodexUsage(t, home)
	entry := usage.Skills["fixture-skill"]
	if entry.Count != 1 || !containsString(entry.Paths, skillPath) {
		t.Fatalf("expected Bash SKILL.md usage from Codex, got %#v", usage.Skills)
	}
}

func runCodexInstall(t *testing.T, root, home string) {
	t.Helper()
	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
		filepath.Join(root, "hooks", "install.ps1"), "-Agent", "codex", "-UserHome", home)
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("install.ps1 failed: %v\n%s", err, out)
	}
}

func runCodexUninstall(t *testing.T, root, home string) {
	t.Helper()
	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
		filepath.Join(root, "hooks", "uninstall.ps1"), "-Agent", "codex", "-UserHome", home)
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("uninstall.ps1 failed: %v\n%s", err, out)
	}
}

func runCodexHook(t *testing.T, home string, payload []byte) []byte {
	t.Helper()
	cmd := exec.Command("node", filepath.Join(repoRoot(t), "hooks", "codex", "record-skill-read.cjs"), string(payload))
	cmd.Env = append(os.Environ(), "USERPROFILE="+home, "HOME="+home)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("codex record-skill-read.cjs failed: %v\n%s", err, out)
	}
	return out
}

func managedCodexCommand(home string) string {
	managedDir := filepath.ToSlash(filepath.Join(home, ".codex", "hooks", "skillsmanager", "codex"))
	return `node "` + managedDir + `/record-skill-read.cjs"`
}

func assertManagedCodexHook(t *testing.T, hooks map[string][]codexHookGroup, event, matcher, home string, raw []byte) {
	t.Helper()
	wantCommand := managedCodexCommand(home)
	for _, group := range hooks[event] {
		if matcher != "" && group.Matcher != matcher {
			continue
		}
		for _, hook := range group.Hooks {
			if hook.Command == wantCommand {
				return
			}
		}
	}
	t.Fatalf("managed %s hook is missing: %s", event, raw)
}

func containsCodexCommand(groups []codexHookGroup, command string) bool {
	for _, group := range groups {
		for _, hook := range group.Hooks {
			if hook.Command == command {
				return true
			}
		}
	}
	return false
}

type codexUsage struct {
	Skills map[string]struct {
		Count      int      `json:"count"`
		LastSource string   `json:"lastSource"`
		Paths      []string `json:"paths"`
	} `json:"skills"`
}

func loadCodexUsage(t *testing.T, home string) codexUsage {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(home, ".skillsmanager", "skills", "skill-usage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var usage codexUsage
	if err := json.Unmarshal(raw, &usage); err != nil {
		t.Fatalf("parse skill usage: %v\n%s", err, raw)
	}
	return usage
}
