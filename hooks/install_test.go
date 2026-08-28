package hooks_test

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestInstallCursorAgentPreservesExistingHooks(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("install.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	cursorDir := filepath.Join(home, ".cursor")
	if err := os.MkdirAll(cursorDir, 0o755); err != nil {
		t.Fatal(err)
	}

	existing := []byte(`{
  "version": 1,
  "hooks": {
    "beforeShellExecution": [
      {
        "command": ".cursor/hooks/user-audit.sh"
      }
    ]
  }
}
`)
	if err := os.WriteFile(filepath.Join(cursorDir, "hooks.json"), existing, 0o644); err != nil {
		t.Fatal(err)
	}

	root := repoRoot(t)
	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
		filepath.Join(root, "hooks", "install.ps1"),
		"-Agent", "cursor",
		"-UserHome", home,
	)
	cmd.Dir = root
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("install.ps1 failed: %v\n%s", err, out)
	}

	raw, err := os.ReadFile(filepath.Join(cursorDir, "hooks.json"))
	if err != nil {
		t.Fatal(err)
	}

	var hooksFile struct {
		Hooks map[string][]map[string]any `json:"hooks"`
	}
	if err := json.Unmarshal(raw, &hooksFile); err != nil {
		t.Fatalf("parse hooks.json: %v\n%s", err, raw)
	}

	shellEntries := hooksFile.Hooks["beforeShellExecution"]
	if len(shellEntries) != 1 || shellEntries[0]["command"] != ".cursor/hooks/user-audit.sh" {
		t.Fatalf("user beforeShellExecution hook was not preserved: %s", raw)
	}

	assertManagedCursorHook(t, hooksFile.Hooks, "beforeReadFile", raw)
	assertManagedCursorHook(t, hooksFile.Hooks, "preToolUse", raw)
	assertManagedCursorHook(t, hooksFile.Hooks, "beforeSubmitPrompt", raw)
}

func assertManagedCursorHook(t *testing.T, hooks map[string][]map[string]any, event string, raw []byte) {
	t.Helper()
	found := false
	for _, entry := range hooks[event] {
		if entry["command"] == `node "hooks/skillsmanager/cursor/record-skill-read.cjs"` {
			found = true
			if event == "preToolUse" {
				matcher, _ := entry["matcher"].(string)
				if matcher != "Read" {
					t.Fatalf("preToolUse matcher want Read, got %v in %s", entry["matcher"], raw)
				}
			}
			if event == "beforeSubmitPrompt" {
				matcher, _ := entry["matcher"].(string)
				if matcher != "UserPromptSubmit" {
					t.Fatalf("beforeSubmitPrompt matcher want UserPromptSubmit, got %v in %s", entry["matcher"], raw)
				}
			}
			break
		}
	}
	if !found {
		t.Fatalf("managed %s entry missing after merge: %s", event, raw)
	}
}

func TestInstallCursorAgentIsIdempotent(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("install.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	root := repoRoot(t)
	script := filepath.Join(root, "hooks", "install.ps1")

	runInstall := func() {
		t.Helper()
		cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
			"-Agent", "cursor",
			"-UserHome", home,
		)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("install.ps1 failed: %v\n%s", err, out)
		}
	}

	runInstall()
	runInstall()

	raw, err := os.ReadFile(filepath.Join(home, ".cursor", "hooks.json"))
	if err != nil {
		t.Fatal(err)
	}
	var hooksFile struct {
		Hooks map[string][]map[string]any `json:"hooks"`
	}
	if err := json.Unmarshal(raw, &hooksFile); err != nil {
		t.Fatalf("parse hooks.json: %v\n%s", err, raw)
	}

	for _, event := range []string{"beforeReadFile", "preToolUse", "beforeSubmitPrompt"} {
		count := 0
		for _, entry := range hooksFile.Hooks[event] {
			if entry["command"] == `node "hooks/skillsmanager/cursor/record-skill-read.cjs"` {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("expected exactly one managed %s entry after reinstall, got %d: %s", event, count, raw)
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
	cursorCount := 0
	for _, agent := range state.Agents {
		if agent == "cursor" {
			cursorCount++
		}
	}
	if cursorCount != 1 {
		t.Fatalf("expected cursor listed once in state, got %s", stateRaw)
	}
}

func TestInstallCursorAgentSkipsWhenNodeMissing(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("install.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	root := repoRoot(t)
	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
		filepath.Join(root, "hooks", "install.ps1"),
		"-Agent", "cursor",
		"-UserHome", home,
	)
	cmd.Dir = root
	cmd.Env = []string{
		"SystemRoot=" + os.Getenv("SystemRoot"),
		"USERPROFILE=" + home,
		"PATH=" + filepath.Join(home, "empty-bin"),
	}
	out, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("expected install to fail when node is missing, output:\n%s", out)
	}

	managedScript := filepath.Join(home, ".cursor", "hooks", "skillsmanager", "cursor", "record-skill-read.cjs")
	if _, statErr := os.Stat(managedScript); !os.IsNotExist(statErr) {
		t.Fatalf("managed script should not be installed without node, err=%v\n%s", statErr, out)
	}
	if _, statErr := os.Stat(filepath.Join(home, ".cursor", "hooks.json")); !os.IsNotExist(statErr) {
		t.Fatalf("hooks.json should not be created without node, err=%v\n%s", statErr, out)
	}
}

func TestInstallCursorAgentRegistersManagedHook(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("install.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	root := repoRoot(t)
	script := filepath.Join(root, "hooks", "install.ps1")

	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
		"-Agent", "cursor",
		"-UserHome", home,
	)
	cmd.Dir = root
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("install.ps1 failed: %v\n%s", err, out)
	}

	managedScript := filepath.Join(home, ".cursor", "hooks", "skillsmanager", "cursor", "record-skill-read.cjs")
	if _, err := os.Stat(managedScript); err != nil {
		t.Fatalf("managed hook script missing: %v", err)
	}

	hooksJSONPath := filepath.Join(home, ".cursor", "hooks.json")
	raw, err := os.ReadFile(hooksJSONPath)
	if err != nil {
		t.Fatalf("read hooks.json: %v", err)
	}

	var hooksFile struct {
		Hooks map[string][]map[string]any `json:"hooks"`
	}
	if err := json.Unmarshal(raw, &hooksFile); err != nil {
		t.Fatalf("parse hooks.json: %v\n%s", err, raw)
	}

	assertManagedCursorHook(t, hooksFile.Hooks, "beforeReadFile", raw)
	assertManagedCursorHook(t, hooksFile.Hooks, "preToolUse", raw)
	assertManagedCursorHook(t, hooksFile.Hooks, "beforeSubmitPrompt", raw)

	statePath := filepath.Join(home, ".skillsmanager", "hooks-state.json")
	stateRaw, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatalf("read hooks-state.json: %v", err)
	}

	var state struct {
		Agents []string `json:"agents"`
	}
	if err := json.Unmarshal(stateRaw, &state); err != nil {
		t.Fatalf("parse hooks-state.json: %v\n%s", err, stateRaw)
	}

	if !containsString(state.Agents, "cursor") {
		t.Fatalf("hooks-state.json missing cursor, got: %s", stateRaw)
	}
}

func TestInstallOpenCodeAgentPreservesUserPlugins(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("install.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", "")
	pluginDir := filepath.Join(home, ".config", "opencode", "plugins")
	if err := os.MkdirAll(pluginDir, 0o755); err != nil {
		t.Fatal(err)
	}
	userPlugin := filepath.Join(pluginDir, "user-plugin.js")
	if err := os.WriteFile(userPlugin, []byte("export default async () => ({})\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	root := repoRoot(t)
	runOpenCodeInstall(t, root, home)
	runOpenCodeInstall(t, root, home)

	if _, err := os.Stat(userPlugin); err != nil {
		t.Fatalf("user plugin should remain: %v", err)
	}
	managedPlugin := filepath.Join(pluginDir, "skillsmanager-opencode.js")
	pluginSource, err := os.ReadFile(managedPlugin)
	if err != nil {
		t.Fatalf("managed OpenCode plugin missing: %v", err)
	}
	if !strings.Contains(string(pluginSource), "tool.execute.before") {
		t.Fatalf("managed plugin does not register a tool hook: %s", pluginSource)
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
	if !containsString(state.Agents, "opencode") {
		t.Fatalf("hooks-state.json missing opencode: %s", stateRaw)
	}
}

func TestInstallClaudeAgentPreservesExistingSettings(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("install.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	claudeDir := filepath.Join(home, ".claude")
	if err := os.MkdirAll(claudeDir, 0o755); err != nil {
		t.Fatal(err)
	}

	existing := []byte(`{
  "env": {
    "ANTHROPIC_API_KEY": "keep-me"
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \".claude/hooks/user-audit.cjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
`)
	if err := os.WriteFile(filepath.Join(claudeDir, "settings.json"), existing, 0o644); err != nil {
		t.Fatal(err)
	}

	root := repoRoot(t)
	runClaudeInstall(t, root, home)

	raw, err := os.ReadFile(filepath.Join(claudeDir, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}

	var settings struct {
		Env   map[string]string          `json:"env"`
		Hooks map[string][]claudeHookGroup `json:"hooks"`
	}
	if err := json.Unmarshal(raw, &settings); err != nil {
		t.Fatalf("parse settings.json: %v\n%s", err, raw)
	}

	if settings.Env["ANTHROPIC_API_KEY"] != "keep-me" {
		t.Fatalf("env field was not preserved: %s", raw)
	}

	userFound := false
	for _, group := range settings.Hooks["PreToolUse"] {
		if group.Matcher != "Bash" {
			continue
		}
		for _, hook := range group.Hooks {
			if hook.Command == `node ".claude/hooks/user-audit.cjs"` {
				userFound = true
			}
		}
	}
	if !userFound {
		t.Fatalf("user PreToolUse hook was not preserved: %s", raw)
	}

	assertManagedClaudeHook(t, settings.Hooks, "PreToolUse", "Read|Skill", home, raw)
	assertManagedClaudeHook(t, settings.Hooks, "UserPromptExpansion", "", home, raw)
}

func TestInstallClaudeAgentIsIdempotent(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("install.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	root := repoRoot(t)

	runClaudeInstall(t, root, home)
	runClaudeInstall(t, root, home)

	raw, err := os.ReadFile(filepath.Join(home, ".claude", "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	var settings struct {
		Hooks map[string][]claudeHookGroup `json:"hooks"`
	}
	if err := json.Unmarshal(raw, &settings); err != nil {
		t.Fatalf("parse settings.json: %v\n%s", err, raw)
	}

	wantCommand := managedClaudeCommand(home)
	for _, event := range []string{"PreToolUse", "UserPromptExpansion"} {
		count := 0
		for _, group := range settings.Hooks[event] {
			for _, hook := range group.Hooks {
				if hook.Command == wantCommand {
					count++
				}
			}
		}
		if count != 1 {
			t.Fatalf("expected exactly one managed %s entry after reinstall, got %d: %s", event, count, raw)
		}
	}
}

func TestInstallClaudeAgentRegistersManagedHook(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("install.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	root := repoRoot(t)
	runClaudeInstall(t, root, home)

	managedScript := filepath.Join(home, ".claude", "hooks", "skillsmanager", "claude", "record-skill-read.cjs")
	if _, err := os.Stat(managedScript); err != nil {
		t.Fatalf("managed hook script missing: %v", err)
	}

	raw, err := os.ReadFile(filepath.Join(home, ".claude", "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	var settings struct {
		Hooks map[string][]claudeHookGroup `json:"hooks"`
	}
	if err := json.Unmarshal(raw, &settings); err != nil {
		t.Fatalf("parse settings.json: %v\n%s", err, raw)
	}

	assertManagedClaudeHook(t, settings.Hooks, "PreToolUse", "Read|Skill", home, raw)
	assertManagedClaudeHook(t, settings.Hooks, "UserPromptExpansion", "", home, raw)

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
	if !containsString(state.Agents, "claude") {
		t.Fatalf("hooks-state.json missing claude: %s", stateRaw)
	}
}

func TestRecordClaudeSkillReadFromUserPromptExpansion(t *testing.T) {
	home := t.TempDir()
	root := repoRoot(t)
	hookPath := filepath.Join(root, "hooks", "claude", "record-skill-read.cjs")
	payload, err := json.Marshal(map[string]any{
		"hook_event_name": "UserPromptExpansion",
		"command_name":    "/fixture-skill",
	})
	if err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command("node", hookPath, string(payload))
	cmd.Env = append(os.Environ(), "USERPROFILE="+home, "HOME="+home)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("claude record-skill-read.cjs failed: %v\n%s", err, out)
	}
	if strings.TrimSpace(string(out)) != "" {
		t.Fatalf("expected empty stdout for UserPromptExpansion, got: %s", out)
	}

	usagePath := filepath.Join(home, ".skillsmanager", "skills", "skill-usage.json")
	raw, err := os.ReadFile(usagePath)
	if err != nil {
		t.Fatal(err)
	}
	var usage struct {
		Skills map[string]struct {
			Count      int    `json:"count"`
			LastSource string `json:"lastSource"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(raw, &usage); err != nil {
		t.Fatal(err)
	}
	if usage.Skills["fixture-skill"].Count != 1 {
		t.Fatalf("expected slash skill recorded, got %s", raw)
	}
	if usage.Skills["fixture-skill"].LastSource != "claude-code" {
		t.Fatalf("expected lastSource claude-code, got %s", raw)
	}
}

func TestRecordClaudeSkillReadFromSkillTool(t *testing.T) {
	home := t.TempDir()
	root := repoRoot(t)
	hookPath := filepath.Join(root, "hooks", "claude", "record-skill-read.cjs")
	payload, err := json.Marshal(map[string]any{
		"hook_event_name": "PreToolUse",
		"tool_name":       "Skill",
		"tool_input":      map[string]string{"skill": "tool-skill"},
	})
	if err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command("node", hookPath, string(payload))
	cmd.Env = append(os.Environ(), "USERPROFILE="+home, "HOME="+home)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("claude record-skill-read.cjs failed: %v\n%s", err, out)
	}

	usagePath := filepath.Join(home, ".skillsmanager", "skills", "skill-usage.json")
	raw, err := os.ReadFile(usagePath)
	if err != nil {
		t.Fatal(err)
	}
	var usage struct {
		Skills map[string]struct {
			Count int `json:"count"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(raw, &usage); err != nil {
		t.Fatal(err)
	}
	if usage.Skills["tool-skill"].Count != 1 {
		t.Fatalf("expected Skill tool recorded, got %s", raw)
	}
}

type claudeHookGroup struct {
	Matcher string `json:"matcher"`
	Hooks   []struct {
		Type    string `json:"type"`
		Command string `json:"command"`
		Timeout int    `json:"timeout"`
	} `json:"hooks"`
}

func managedClaudeCommand(home string) string {
	managedDir := filepath.ToSlash(filepath.Join(home, ".claude", "hooks", "skillsmanager", "claude"))
	return `node "` + managedDir + `/record-skill-read.cjs"`
}

func assertManagedClaudeHook(t *testing.T, hooks map[string][]claudeHookGroup, event, wantMatcher, home string, raw []byte) {
	t.Helper()
	wantCommand := managedClaudeCommand(home)
	found := false
	for _, group := range hooks[event] {
		if wantMatcher != "" && group.Matcher != wantMatcher {
			continue
		}
		for _, hook := range group.Hooks {
			if hook.Command == wantCommand {
				found = true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatalf("managed %s entry missing after merge: %s", event, raw)
	}
}

func TestOpenCodePluginRecordsSkillReads(t *testing.T) {
	home := t.TempDir()
	skillPath := filepath.Join(home, "fixture-skill", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(skillPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(skillPath, []byte("---\nname: fixture-skill\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	root := repoRoot(t)
	pluginSource, err := os.ReadFile(filepath.Join(root, "hooks", "opencode", "skillsmanager-opencode.js"))
	if err != nil {
		t.Fatal(err)
	}
	pluginPath := filepath.Join(t.TempDir(), "skillsmanager-opencode.mjs")
	if err := os.WriteFile(pluginPath, pluginSource, 0o644); err != nil {
		t.Fatal(err)
	}
	runnerPath := filepath.Join(t.TempDir(), "run-plugin.mjs")
	pluginURL := (&url.URL{Scheme: "file", Path: filepath.ToSlash(pluginPath)}).String()
	runner := fmt.Sprintf(`import plugin from %q;
const hooks = await plugin();
await hooks["tool.execute.before"]({ tool: "read" }, { args: { filePath: %q } });
`, pluginURL, filepath.ToSlash(skillPath))
	if err := os.WriteFile(runnerPath, []byte(runner), 0o644); err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command("node", runnerPath)
	cmd.Env = append(os.Environ(), "USERPROFILE="+home, "HOME="+home)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("OpenCode plugin failed: %v\n%s", err, out)
	}

	usageRaw, err := os.ReadFile(filepath.Join(home, ".skillsmanager", "skills", "skill-usage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var usage struct {
		Skills map[string]struct {
			Count int `json:"count"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(usageRaw, &usage); err != nil {
		t.Fatal(err)
	}
	if usage.Skills["fixture-skill"].Count != 1 {
		t.Fatalf("expected one OpenCode skill read, got %s", usageRaw)
	}
}

func TestOpenCodePluginRecordsNativeSkillTool(t *testing.T) {
	home := t.TempDir()
	root := repoRoot(t)
	pluginSource, err := os.ReadFile(filepath.Join(root, "hooks", "opencode", "skillsmanager-opencode.js"))
	if err != nil {
		t.Fatal(err)
	}
	pluginPath := filepath.Join(t.TempDir(), "skillsmanager-opencode.mjs")
	if err := os.WriteFile(pluginPath, pluginSource, 0o644); err != nil {
		t.Fatal(err)
	}
	runnerPath := filepath.Join(t.TempDir(), "run-plugin.mjs")
	pluginURL := (&url.URL{Scheme: "file", Path: filepath.ToSlash(pluginPath)}).String()
	runner := fmt.Sprintf(`import plugin from %q;
const hooks = await plugin();
await hooks["tool.execute.before"]({ tool: "skill" }, { args: { name: "fixture-skill" } });
`, pluginURL)
	if err := os.WriteFile(runnerPath, []byte(runner), 0o644); err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command("node", runnerPath)
	cmd.Env = append(os.Environ(), "USERPROFILE="+home, "HOME="+home)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("OpenCode plugin failed: %v\n%s", err, out)
	}

	usageRaw, err := os.ReadFile(filepath.Join(home, ".skillsmanager", "skills", "skill-usage.json"))
	if err != nil {
		t.Fatal(err)
	}
	var usage struct {
		Skills map[string]struct {
			Count int `json:"count"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(usageRaw, &usage); err != nil {
		t.Fatal(err)
	}
	if usage.Skills["fixture-skill"].Count != 1 {
		t.Fatalf("expected native skill tool usage, got %s", usageRaw)
	}
}

func TestRecordSkillReadWritesUsageToUserHome(t *testing.T) {
	home := t.TempDir()
	skillPath := filepath.Join(home, "fixture-skill", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(skillPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(skillPath, []byte("---\nname: fixture-skill\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	root := repoRoot(t)
	hookPath := filepath.Join(root, "hooks", "cursor", "record-skill-read.cjs")
	payload, err := json.Marshal(map[string]string{"file_path": skillPath})
	if err != nil {
		t.Fatal(err)
	}

	for range 2 {
		cmd := exec.Command("node", hookPath, string(payload))
		cmd.Env = append(os.Environ(), "USERPROFILE="+home, "HOME="+home)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("record-skill-read.cjs failed: %v\n%s", err, out)
		}
	}

	usagePath := filepath.Join(home, ".skillsmanager", "skills", "skill-usage.json")
	raw, err := os.ReadFile(usagePath)
	if err != nil {
		t.Fatalf("read skill usage at %s: %v", usagePath, err)
	}
	var usage struct {
		Version int `json:"version"`
		Skills  map[string]struct {
			Count int            `json:"count"`
			Paths []string       `json:"paths"`
			Daily map[string]int `json:"daily"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(raw, &usage); err != nil {
		t.Fatalf("parse skill usage: %v\n%s", err, raw)
	}

	record := usage.Skills["fixture-skill"]
	if record.Count != 2 {
		t.Fatalf("expected two recorded reads, got %d: %s", record.Count, raw)
	}
	if len(record.Paths) != 1 || record.Paths[0] != skillPath {
		t.Fatalf("expected only the read skill path, got %s", raw)
	}
	if usage.Version != 2 {
		t.Fatalf("expected usage version 2, got %d", usage.Version)
	}
	totalDaily := 0
	for _, n := range record.Daily {
		totalDaily += n
	}
	if totalDaily != 2 {
		t.Fatalf("expected daily totals of 2, got %v in %s", record.Daily, raw)
	}
}

func TestRecordSkillReadFromBeforeSubmitPromptSlash(t *testing.T) {
	home := t.TempDir()
	root := repoRoot(t)
	hookPath := filepath.Join(root, "hooks", "cursor", "record-skill-read.cjs")
	payload, err := json.Marshal(map[string]any{
		"hook_event_name": "beforeSubmitPrompt",
		"prompt":          "/grill-with-docs please run a session",
		"attachments":     []any{},
	})
	if err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command("node", hookPath, string(payload))
	cmd.Env = append(os.Environ(), "USERPROFILE="+home, "HOME="+home)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("record-skill-read.cjs failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), `"continue":true`) {
		t.Fatalf("expected continue:true on stdout for beforeSubmitPrompt, got: %s", out)
	}

	usagePath := filepath.Join(home, ".skillsmanager", "skills", "skill-usage.json")
	raw, err := os.ReadFile(usagePath)
	if err != nil {
		t.Fatal(err)
	}
	var usage struct {
		Skills map[string]struct {
			Count      int    `json:"count"`
			LastSource string `json:"lastSource"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(raw, &usage); err != nil {
		t.Fatal(err)
	}
	if usage.Skills["grill-with-docs"].Count != 1 {
		t.Fatalf("expected slash skill recorded, got %s", raw)
	}
	if usage.Skills["grill-with-docs"].LastSource != "beforeSubmitPrompt" {
		t.Fatalf("expected lastSource beforeSubmitPrompt, got %s", raw)
	}
}

func TestRecordSkillReadFromBeforeSubmitPromptAttachment(t *testing.T) {
	home := t.TempDir()
	skillPath := filepath.Join(home, "attached-skill", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(skillPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(skillPath, []byte("---\nname: attached-skill\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	root := repoRoot(t)
	hookPath := filepath.Join(root, "hooks", "cursor", "record-skill-read.cjs")
	payload, err := json.Marshal(map[string]any{
		"hook_event_name": "beforeSubmitPrompt",
		"prompt":          "use the attached skill",
		"attachments": []any{
			map[string]string{
				"type":      "file",
				"file_path": skillPath,
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command("node", hookPath, string(payload))
	cmd.Env = append(os.Environ(), "USERPROFILE="+home, "HOME="+home)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("record-skill-read.cjs failed: %v\n%s", err, out)
	}

	usagePath := filepath.Join(home, ".skillsmanager", "skills", "skill-usage.json")
	raw, err := os.ReadFile(usagePath)
	if err != nil {
		t.Fatal(err)
	}
	var usage struct {
		Skills map[string]struct {
			Count int      `json:"count"`
			Paths []string `json:"paths"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(raw, &usage); err != nil {
		t.Fatal(err)
	}
	if usage.Skills["attached-skill"].Count != 1 {
		t.Fatalf("expected attached SKILL.md recorded, got %s", raw)
	}
	if len(usage.Skills["attached-skill"].Paths) != 1 || usage.Skills["attached-skill"].Paths[0] != skillPath {
		t.Fatalf("expected attachment path recorded, got %s", raw)
	}
}

func TestRecordSkillReadFromPreToolUsePayload(t *testing.T) {
	home := t.TempDir()
	skillPath := filepath.Join(home, "pretool-skill", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(skillPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(skillPath, []byte("---\nname: pretool-skill\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	root := repoRoot(t)
	hookPath := filepath.Join(root, "hooks", "cursor", "record-skill-read.cjs")
	payload, err := json.Marshal(map[string]any{
		"hook_event_name": "preToolUse",
		"tool_name":       "Read",
		"tool_input":      map[string]string{"path": skillPath},
	})
	if err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command("node", hookPath, string(payload))
	cmd.Env = append(os.Environ(), "USERPROFILE="+home, "HOME="+home)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("record-skill-read.cjs failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), `"permission":"allow"`) {
		t.Fatalf("expected allow permission on stdout, got: %s", out)
	}

	usagePath := filepath.Join(home, ".skillsmanager", "skills", "skill-usage.json")
	raw, err := os.ReadFile(usagePath)
	if err != nil {
		t.Fatal(err)
	}
	var usage struct {
		Skills map[string]struct {
			Count int `json:"count"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(raw, &usage); err != nil {
		t.Fatal(err)
	}
	if usage.Skills["pretool-skill"].Count != 1 {
		t.Fatalf("expected preToolUse read recorded, got %s", raw)
	}
}

func TestRecordSkillReadDedupsDualHookEvents(t *testing.T) {
	home := t.TempDir()
	skillPath := filepath.Join(home, "dual-hook-skill", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(skillPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(skillPath, []byte("---\nname: dual-hook-skill\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	root := repoRoot(t)
	hookPath := filepath.Join(root, "hooks", "cursor", "record-skill-read.cjs")
	run := func(payload any) {
		t.Helper()
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command("node", hookPath, string(raw))
		cmd.Env = append(os.Environ(), "USERPROFILE="+home, "HOME="+home)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("record-skill-read.cjs failed: %v\n%s", err, out)
		}
	}

	run(map[string]any{
		"hook_event_name": "preToolUse",
		"tool_name":       "Read",
		"tool_input":      map[string]string{"path": skillPath},
	})
	run(map[string]any{
		"hook_event_name": "beforeReadFile",
		"file_path":       skillPath,
		"content":         "see other/SKILL.md mentioned in body",
	})

	usagePath := filepath.Join(home, ".skillsmanager", "skills", "skill-usage.json")
	raw, err := os.ReadFile(usagePath)
	if err != nil {
		t.Fatal(err)
	}
	var usage struct {
		Skills map[string]struct {
			Count int `json:"count"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(raw, &usage); err != nil {
		t.Fatal(err)
	}
	if usage.Skills["dual-hook-skill"].Count != 1 {
		t.Fatalf("expected dual-hook dedup to keep count=1, got %s", raw)
	}
}

func TestRecordSkillReadAggregatesTranslationUnderSkillID(t *testing.T) {
	home := t.TempDir()
	skillPath := filepath.Join(home, "skills_translation", "demo-skill", "zh-CN", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(skillPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(skillPath, []byte("---\nname: demo\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	root := repoRoot(t)
	hookPath := filepath.Join(root, "hooks", "cursor", "record-skill-read.cjs")
	payload, err := json.Marshal(map[string]string{"file_path": skillPath})
	if err != nil {
		t.Fatal(err)
	}

	cmd := exec.Command("node", hookPath, string(payload))
	cmd.Env = append(os.Environ(), "USERPROFILE="+home, "HOME="+home)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("record-skill-read.cjs failed: %v\n%s", err, out)
	}

	usagePath := filepath.Join(home, ".skillsmanager", "skills", "skill-usage.json")
	raw, err := os.ReadFile(usagePath)
	if err != nil {
		t.Fatal(err)
	}
	var usage struct {
		Skills map[string]struct {
			Count int `json:"count"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(raw, &usage); err != nil {
		t.Fatal(err)
	}
	if usage.Skills["demo-skill"].Count != 1 {
		t.Fatalf("expected demo-skill key, got %s", raw)
	}
	if _, ok := usage.Skills["zh-CN"]; ok {
		t.Fatalf("should not key by language tag, got %s", raw)
	}
}

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Dir(filepath.Dir(file))
}

func containsString(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

func runOpenCodeInstall(t *testing.T, root, home string) {
	t.Helper()
	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
		filepath.Join(root, "hooks", "install.ps1"),
		"-Agent", "opencode",
		"-UserHome", home,
	)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "USERPROFILE="+home, "HOME="+home, "XDG_CONFIG_HOME=")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("install.ps1 failed: %v\n%s", err, out)
	}
}

func runClaudeInstall(t *testing.T, root, home string) {
	t.Helper()
	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
		filepath.Join(root, "hooks", "install.ps1"),
		"-Agent", "claude",
		"-UserHome", home,
	)
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("install.ps1 failed: %v\n%s", err, out)
	}
}
