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

func TestUninstallCursorAgentRemovesOnlyManagedHooks(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("uninstall.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	root := repoRoot(t)

	install := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
		filepath.Join(root, "hooks", "install.ps1"),
		"-Agent", "cursor",
		"-UserHome", home,
	)
	install.Dir = root
	if out, err := install.CombinedOutput(); err != nil {
		t.Fatalf("install.ps1 failed: %v\n%s", err, out)
	}

	hooksJSONPath := filepath.Join(home, ".cursor", "hooks.json")
	raw, err := os.ReadFile(hooksJSONPath)
	if err != nil {
		t.Fatal(err)
	}

	var hooksFile map[string]any
	if err := json.Unmarshal(raw, &hooksFile); err != nil {
		t.Fatal(err)
	}
	hooks, _ := hooksFile["hooks"].(map[string]any)
	hooks["beforeShellExecution"] = []map[string]any{
		{"command": ".cursor/hooks/user-audit.sh"},
	}
	merged, err := json.MarshalIndent(hooksFile, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(hooksJSONPath, append(merged, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}

	uninstall := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
		filepath.Join(root, "hooks", "uninstall.ps1"),
		"-Agent", "cursor",
		"-UserHome", home,
	)
	uninstall.Dir = root
	if out, err := uninstall.CombinedOutput(); err != nil {
		t.Fatalf("uninstall.ps1 failed: %v\n%s", err, out)
	}

	managedScript := filepath.Join(home, ".cursor", "hooks", "skillsmanager", "cursor", "record-skill-read.cjs")
	if _, err := os.Stat(managedScript); !os.IsNotExist(err) {
		t.Fatalf("managed script should be removed, err=%v", err)
	}

	raw, err = os.ReadFile(hooksJSONPath)
	if err != nil {
		t.Fatal(err)
	}
	var after struct {
		Hooks map[string][]map[string]any `json:"hooks"`
	}
	if err := json.Unmarshal(raw, &after); err != nil {
		t.Fatalf("parse hooks.json: %v\n%s", err, raw)
	}

	if len(after.Hooks["beforeReadFile"]) != 0 {
		t.Fatalf("managed beforeReadFile entries should be gone: %s", raw)
	}
	if len(after.Hooks["preToolUse"]) != 0 {
		t.Fatalf("managed preToolUse entries should be gone: %s", raw)
	}
	if len(after.Hooks["beforeSubmitPrompt"]) != 0 {
		t.Fatalf("managed beforeSubmitPrompt entries should be gone: %s", raw)
	}
	shell := after.Hooks["beforeShellExecution"]
	if len(shell) != 1 || shell[0]["command"] != ".cursor/hooks/user-audit.sh" {
		t.Fatalf("user hook should remain: %s", raw)
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
	if containsString(state.Agents, "cursor") {
		t.Fatalf("cursor should be removed from state: %s", stateRaw)
	}
}

func TestUninstallOpenCodeAgentRemovesOnlyManagedPlugin(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("uninstall.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	root := repoRoot(t)
	pluginDir := filepath.Join(home, ".config", "opencode", "plugins")
	if err := os.MkdirAll(pluginDir, 0o755); err != nil {
		t.Fatal(err)
	}
	userPlugin := filepath.Join(pluginDir, "user-plugin.js")
	if err := os.WriteFile(userPlugin, []byte("export default async () => ({})\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	runOpenCodeInstall(t, root, home)
	uninstall := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
		filepath.Join(root, "hooks", "uninstall.ps1"),
		"-Agent", "opencode",
		"-UserHome", home,
	)
	uninstall.Dir = root
	uninstall.Env = append(os.Environ(), "USERPROFILE="+home, "HOME="+home, "XDG_CONFIG_HOME=")
	if out, err := uninstall.CombinedOutput(); err != nil {
		t.Fatalf("uninstall.ps1 failed: %v\n%s", err, out)
	}

	managedPlugin := filepath.Join(pluginDir, "skillsmanager-opencode.js")
	if _, err := os.Stat(managedPlugin); !os.IsNotExist(err) {
		t.Fatalf("managed OpenCode plugin should be removed, err=%v", err)
	}
	if _, err := os.Stat(userPlugin); err != nil {
		t.Fatalf("user plugin should remain: %v", err)
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
	if containsString(state.Agents, "opencode") {
		t.Fatalf("opencode should be removed from state: %s", stateRaw)
	}
}

func TestUninstallClaudeAgentRemovesOnlyManagedHooks(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("uninstall.ps1 is exercised on Windows in this slice")
	}

	home := t.TempDir()
	root := repoRoot(t)
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

	runClaudeInstall(t, root, home)

	uninstall := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
		filepath.Join(root, "hooks", "uninstall.ps1"),
		"-Agent", "claude",
		"-UserHome", home,
	)
	uninstall.Dir = root
	if out, err := uninstall.CombinedOutput(); err != nil {
		t.Fatalf("uninstall.ps1 failed: %v\n%s", err, out)
	}

	managedScript := filepath.Join(home, ".claude", "hooks", "skillsmanager", "claude", "record-skill-read.cjs")
	if _, err := os.Stat(managedScript); !os.IsNotExist(err) {
		t.Fatalf("managed script should be removed, err=%v", err)
	}

	raw, err := os.ReadFile(filepath.Join(claudeDir, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	var after struct {
		Env   map[string]string `json:"env"`
		Hooks map[string][]struct {
			Matcher string `json:"matcher"`
			Hooks   []struct {
				Command string `json:"command"`
			} `json:"hooks"`
		} `json:"hooks"`
	}
	if err := json.Unmarshal(raw, &after); err != nil {
		t.Fatalf("parse settings.json: %v\n%s", err, raw)
	}

	if after.Env["ANTHROPIC_API_KEY"] != "keep-me" {
		t.Fatalf("env field should remain: %s", raw)
	}

	managedPrefix := "hooks/skillsmanager/claude"
	for event, groups := range after.Hooks {
		for _, group := range groups {
			for _, hook := range group.Hooks {
				if strings.Contains(hook.Command, managedPrefix) {
					t.Fatalf("managed %s entry should be gone: %s", event, raw)
				}
			}
		}
	}

	userFound := false
	for _, group := range after.Hooks["PreToolUse"] {
		for _, hook := range group.Hooks {
			if hook.Command == `node ".claude/hooks/user-audit.cjs"` {
				userFound = true
			}
		}
	}
	if !userFound {
		t.Fatalf("user hook should remain: %s", raw)
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
	if containsString(state.Agents, "claude") {
		t.Fatalf("claude should be removed from state: %s", stateRaw)
	}
}
