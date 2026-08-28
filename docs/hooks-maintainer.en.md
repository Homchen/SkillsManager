# Official hook installer

**Language:** [中文](hooks-maintainer.md) · English

For **this repository’s** contributors: how `hooks/` installs managed hooks for Cursor / Claude Code / Codex / OpenCode into the user home directory.

The stats-file contract, and writing a hook for your own Agent, are in [Hooks extension](hooks-extension.en.md). Other Agents should **not** land in this repo by default; the installer is not a checkbox per tool.

What to change:

| Situation | What to edit |
| --- | --- |
| Fix script behavior for an already supported Agent | Only scripts under `hooks/<id>/`, then `go test ./hooks` |
| The Agent’s config shape already matches one of the four targets, and you are adding official support | Add `hooks/<id>/` plus a `manifest.json` entry; usually leave `install*.ps1/sh` and `manage.cjs` alone |
| Config-file shape is outside the four targets | Then change `lib/manage.cjs` and add regression tests |
| The installer wizard needs a new checkbox | Then change `build/windows/installer/project.nsi` |

## Layout

```
hooks/
├── manifest.json          # Agent registry (must change when adding an official Agent)
├── install.ps1 / install.sh
├── uninstall.ps1 / uninstall.sh
├── lib/manage.cjs         # shared install / uninstall logic
└── <agentId>/             # scripts for that Agent
    └── *.cjs / *.js
```

After install, the user home directory looks roughly like this:

| Path (relative to `$HOME` / `%USERPROFILE%`) | Role |
| --- | --- |
| `target.hooksJson` (e.g. `.cursor/hooks.json` / `.codex/hooks.json`) | Cursor-style target: merge managed hook entries |
| `target.managedDir` (e.g. `.cursor/hooks/skillsmanager/<agentId>`) | Cursor / Claude-style target: copied scripts |
| `target.settingsJson` (e.g. `.claude/settings.json`) | Claude Code target: merge managed hooks, keep `env` and other fields |
| `target.pluginFile` (e.g. `.config/opencode/plugins/skillsmanager-opencode.js`) | OpenCode plugin target: one managed plugin file |
| `.skillsmanager/hooks-state.json` | Installed Agent list (used by uninstall) |

Cursor / Claude managed entries are identified by the `hooks/skillsmanager/<agentId>` prefix in the command. Install strips old managed entries then merges; uninstall deletes only managed entries and `managedDir`, and does not touch the user’s own hooks. Claude Code commands use a machine-absolute path (`{{managedDir}}` in the manifest, expanded at install time). OpenCode uses a separately named plugin file: install overwrites that file, uninstall deletes only that file, and does not read or write `opencode.json` or user plugins.

## `manifest.json` fields

Root object:

| Field | Meaning |
| --- | --- |
| `version` | Manifest version, currently `1` |
| `agents` | Agent config array |

Each Agent:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique ID; must match directory `hooks/<id>/`; used as `-Agent <id>` |
| `displayName` | recommended | Display name (installer copy can follow this) |
| `defaultSelected` | no | Reserved for installer default-checked |
| `requires` | no | Dependency list; if it includes `node` and node is not on PATH, skip install (exit `2`) |
| `target.hooksJson` | required for Cursor / Codex targets | Hooks config file relative to the user home directory |
| `target.managedDir` | required for Cursor / Claude / Codex targets | Script destination relative to the user home directory |
| `target.settingsJson` | required for Claude target | Claude Code `settings.json` relative to the user home directory |
| `target.type` | no | `opencode-plugin` / `claude-settings` / `codex-hooks-json`; omit for existing Cursor style |
| `target.pluginFile` | required for OpenCode target | Managed plugin file relative to the user home directory |
| `files` | yes | File names copied from `hooks/<id>/` into `managedDir` (or the plugin parent directory) |
| `hooks` | required for Cursor / Claude / Codex | Event → entry list written into config |

`hooks` entries (Cursor-style target):

```json
{
  "preToolUse": [
    {
      "command": "node \"hooks/skillsmanager/<agentId>/<script>.cjs\"",
      "matcher": "Read",
      "timeout": 5
    }
  ],
  "beforeReadFile": [
    {
      "command": "node \"hooks/skillsmanager/<agentId>/<script>.cjs\"",
      "timeout": 5
    }
  ],
  "beforeSubmitPrompt": [
    {
      "command": "node \"hooks/skillsmanager/<agentId>/<script>.cjs\"",
      "matcher": "UserPromptSubmit",
      "timeout": 5
    }
  ]
}
```

Cursor target notes:

- Paths in `command` are relative to the Agent config root (Cursor: `~/.cursor`), **not** the SkillsManager install directory.
- The command must contain `hooks/skillsmanager/<agentId>`, or install/uninstall cannot recognize it as managed.
- Every name in `files` must exist under `hooks/<id>/`, or install fails.
- Cursor skill usage hooks three event classes:
  - `preToolUse` (matcher `Read`) and `beforeReadFile`: count Agent reads of `SKILL.md`. The former covers reads that skip `beforeReadFile` (for example attached skills). Duplicate events for the same Read are deduplicated.
  - `beforeSubmitPrompt` (matcher `UserPromptSubmit`): count user `/skill-name` slash invocations (content is inlined into the conversation and does not go through Read).
  - Read/write-style events must print `{"permission":"allow"}` on stdout; `beforeSubmitPrompt` must print `{"continue":true}`.

Reference implementation: `cursor` in `hooks/manifest.json` plus `hooks/cursor/record-skill-read.cjs`.

Claude Code target (`target.type: "claude-settings"`) example:

```json
{
  "id": "claude",
  "target": {
    "type": "claude-settings",
    "settingsJson": ".claude/settings.json",
    "managedDir": ".claude/hooks/skillsmanager/claude"
  },
  "files": ["record-skill-read.cjs"],
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Skill",
        "hooks": [
          {
            "type": "command",
            "command": "node \"{{managedDir}}/record-skill-read.cjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptExpansion": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"{{managedDir}}/record-skill-read.cjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Claude target notes:

- Claude Code uses a nested shape: event → matcher group → `hooks[]` (with `type` / `command` / `timeout`), unlike Cursor’s flat entries.
- `command` must be a local absolute path. The manifest uses `{{managedDir}}`; install expands it to a POSIX-style absolute path (for example `C:/Users/.../.claude/hooks/skillsmanager/claude`).
- Merge **preserves** existing `env` and other keys in `settings.json`; only `hooks` is changed.
- `UserPromptExpansion` records `/skill-name` slash invocations; `PreToolUse` + `Read|Skill` records reads of `SKILL.md` or Skill tool calls.
- Scripts should always exit 0 with empty stdout (`UserPromptExpansion` stdout enters the model context).

Reference implementation: `claude` in `hooks/manifest.json` plus `hooks/claude/record-skill-read.cjs`.

Codex target (`target.type: "codex-hooks-json"`) example:

```json
{
  "id": "codex",
  "target": {
    "type": "codex-hooks-json",
    "hooksJson": ".codex/hooks.json",
    "managedDir": ".codex/hooks/skillsmanager/codex"
  },
  "files": ["record-skill-read.cjs"],
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Skill|Bash|shell_command|mcp__.*read.*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"{{managedDir}}/record-skill-read.cjs\"",
            "timeout": 5,
            "statusMessage": "Recording Codex skill usage"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"{{managedDir}}/record-skill-read.cjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Codex notes:

- Codex reads a nested event → matcher group → `hooks[]` configuration from `~/.codex/hooks.json`; this is structurally similar to Claude Code’s `settings.json.hooks`.
- Commands require a local absolute path. The installer expands `{{managedDir}}` to a POSIX-style absolute path, for example `C:/Users/.../.codex/hooks/skillsmanager/codex`.
- `UserPromptSubmit` records slash-skill usage. `PreToolUse` records `Skill`, read-like tools, MCP read tools, and Bash/shell commands that reference `SKILL.md`.
- The statistics script must exit `0` and produce no stdout, so it neither injects model context nor blocks the tool call.
- Review and trust the managed hook with Codex `/hooks` after installing or changing its definition.

Reference implementation: `hooks/manifest.json` entry `codex` and `hooks/codex/record-skill-read.cjs`.

OpenCode target example:

```json
{
  "id": "opencode",
  "target": {
    "type": "opencode-plugin",
    "pluginFile": ".config/opencode/plugins/skillsmanager-opencode.js"
  },
  "files": ["skillsmanager-opencode.js"]
}
```

OpenCode automatically loads `.js` / `.ts` plugins placed directly under `~/.config/opencode/plugins/` at startup. Plugins should catch their own bypass-path errors so they do not interfere with Agent tool calls. Restart OpenCode after install or uninstall.

## Adding an official Agent to this repo (checklist)

Use this path only when the Agent is common enough that you will maintain it with the installer, tests, and (optionally) NSIS. For personal use, register the hook on your machine per [Hooks extension](hooks-extension.en.md).

### 1. Write scripts

Put executable scripts under `hooks/<agentId>/` (existing convention is Node `.cjs`, so Windows / macOS / Linux can share them). Scripts must write `~/.skillsmanager/skills/skill-usage.json`; see the user doc for the format.

Hard rules:

- Read the Agent JSON payload from stdin or argv; exit silently if parsing fails.
- On business failure, write stderr only. Do not block the Agent’s main flow because of stats.
- Follow each target’s stdout rules above for Cursor / Claude / Codex.

### 2. Register in the manifest

Append an entry to `agents` in `hooks/manifest.json`: fill in `id`, `target`, `files`, and `hooks`. You **usually do not change** `install*.ps1/sh` or `manage.cjs` — they look up `--agent <id>` in the table.

### 3. Verify locally

```powershell
# Windows
.\hooks\install.ps1 -Agent <agentId>
.\hooks\uninstall.ps1 -Agent <agentId>
# or remove every managed Agent at once
.\hooks\uninstall.ps1 -All
```

```bash
# macOS / Linux
./hooks/install.sh --agent <agentId>
./hooks/uninstall.sh --agent <agentId>
./hooks/uninstall.sh --all
```

Check:

1. Scripts were copied into `managedDir`.
2. `hooksJson` merged the events, and the user’s original entries are still there.
3. Installing again is idempotent (managed entries are not stacked).
4. After uninstall, the managed directory and managed entries are gone, and user-owned entries remain.

Automated regression: `hooks/install_test.go`, `hooks/uninstall_test.go` (add cases following `cursor` / `claude`).

### 4. Optional: NSIS installer component

Change `build/windows/installer/project.nsi` only if you want a new checkbox in the `wails build -nsis` wizard:

1. Add a `File` under `SecApp` so files from `hooks/<agentId>/` land in `$INSTDIR\hooks\<agentId>\`.
2. Add `Section "<DisplayName>" SecXxxHooks` that runs `install.ps1 -Agent <agentId>`.
3. Add `LangString DESC_...` and `MUI_DESCRIPTION_TEXT`.

Skip this step if you only plan to run `hooks/install.*` manually after install. Still put the new script files into the install directory from `SecApp`, or the user’s machine will have nothing to install from.

## When `manage.cjs` needs changes

`lib/manage.cjs` supports four target conventions:

- Cursor default: root object with `version` and `hooks`; managed flat entries are identified by `hooks/skillsmanager/<agentId>` in `command`.
- `target.type: "claude-settings"`: reads and writes full `settings.json` while preserving non-hook keys; nested matcher groups expand `{{managedDir}}` to an absolute path.
- `target.type: "codex-hooks-json"`: reads and writes `~/.codex/hooks.json`, using the same nested matcher-group shape as Claude Code.
- `target.type: "opencode-plugin"`: copies `files` to the parent directory of `target.pluginFile`, and removes only that file when uninstalling.

Extend `installAgent` / `uninstallAgent` and add regression tests when an Agent uses a different registration mechanism or config-file shape.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `2` | Missing `node` (or Agent `requires` not met); skip install |
| Other non-zero | Real failure (bad config / missing files) |

NSIS treats exit `2` as skip, not as installer failure.
