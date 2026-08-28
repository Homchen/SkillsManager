# Hooks extension

**Language:** [中文](hooks-extension.md) · English

For people who use SkillsManager: write a hook for your own Agent tool so the Usage page can record skill calls from that tool.

This repository **does not** take in a hook for every Agent. The installer only ships Cursor, Claude Code, Codex, and OpenCode. For any other tool, write and register the hook on your machine. Do not open a PR whose only goal is “add another Agent.”

To change this repo’s official installer, `manifest.json`, or NSIS checkboxes, see [Official hook installer](hooks-maintainer.en.md).

## What hooks do in this product

SkillsManager **does not** watch Agent processes, and it does not need to be running. It only reads one stats file in the hub:

`~/.skillsmanager/skills/skill-usage.json`  
(Windows: `%USERPROFILE%\.skillsmanager\skills\skill-usage.json`)

A hook’s only job is: when the Agent reads `SKILL.md`, calls a Skill tool, or the user types `/skill-name`, increment that skill in this file. The next time you open the Usage page, the counts show up.

```
Agent event (read SKILL.md / Skill tool / /skill)
        │
        ▼
  your hook (side channel; do not block the Agent)
        │
        ▼
  skill-usage.json     ← this product’s only stats contract
        │
        ▼
  SkillsManager Usage page
```

Skill bodies still live in `~/.skillsmanager/skills`. Hooks only append stats. They must not edit skill files, and they must not depend on the Wails frontend.

## Stats file format

```json
{
  "version": 2,
  "skills": {
    "grill-with-docs": {
      "count": 12,
      "lastUsedAt": "2026-08-28T06:00:00.000Z",
      "paths": [
        "C:/Users/you/.skillsmanager/skills/hub/default/grill-with-docs/SKILL.md"
      ],
      "daily": {
        "2026-08-28": 3
      }
    }
  }
}
```

| Field | Role |
| --- | --- |
| `version` | Currently `2` |
| key in `skills` | Skill id, usually the directory that contains `SKILL.md`; same as `<skill-id>` in hub `hub/<group>/<skill-id>/` |
| `count` | Lifetime total |
| `lastUsedAt` | Last event, ISO 8601 |
| `paths` | Optional. The app uses these paths to map a record onto a managed skill (especially when the key is not an exact id) |
| `daily` | Optional. Keys are local dates `YYYY-MM-DD`; values are that day’s count |

The app only shows **currently managed** skills. Match order: the JSON key equals a managed id → otherwise `paths` points at that skill directory or `SKILL.md` → translation copies under `skills_translation/<skill-id>/...` also match. Unmatched records are ignored and do not clutter the UI.

The app ignores unknown fields (for example `lastSource`). When you read-modify-write, keep existing keys; do not replace the whole file with only your own entry.

Several Agents may write this file at once. The bundled scripts use a sibling `skill-usage.json.lock` (exclusive create) and an atomic replace (write a temp file, then rename). Do the same, or counts will be lost.

## Write a hook for your Agent

1. Look up how that Agent registers hooks or plugins (config file, event names, and the JSON on stdin all differ).
2. When you see a read of `SKILL.md`, a Skill tool call, or a slash skill invoke, update `skill-usage.json` using the format above.
3. Register the script in **that Agent’s own config**. Do not edit the SkillsManager install directory, and do not edit `hooks/manifest.json` in this repo.
4. Verify with a real skill call: `count` for that id increases, and the Usage page shows it.

You can copy the write-file logic from the bundled scripts:

| Agent | Reference |
| --- | --- |
| Cursor | `hooks/cursor/record-skill-read.cjs` |
| Claude Code | `hooks/claude/record-skill-read.cjs` |
| Codex | `hooks/codex/record-skill-read.cjs` |
| OpenCode | `hooks/opencode/skillsmanager-opencode.js` |

Any language is fine. If the same JSON is written, the app can read it.

**Required:**

- Never block the Agent: exit silently on parse failure; write stderr only on business failure.
- Do not assume SkillsManager is running.
- If that Agent injects hook stdout into the model context (Claude `UserPromptExpansion`, for example), stdout must be empty.
- Do not put the substring `hooks/skillsmanager/<id>` in the command. That is how this product’s installer recognizes **official managed entries**; using it can make an official uninstall remove your hook.

**Suggested:**

- Read the Agent JSON payload from stdin or argv.
- Skill id: for a normal copy, use the parent directory of `SKILL.md`; for a translation copy, use `<skill-id>` in `skills_translation/<skill-id>/<lang>/SKILL.md`.
- When you have a file path, append it to `paths` so the app can map onto the hub skill.

Typical registration locations (defer to each tool’s docs):

| Tool | Typical location |
| --- | --- |
| Cursor | `~/.cursor/hooks.json` |
| Claude Code | `hooks` in `~/.claude/settings.json` |
| Codex | `~/.codex/hooks.json` |
| OpenCode | `.js` / `.ts` under `~/.config/opencode/plugins/` |

After changing the config, restart or re-trust the hook the way that tool requires (for example Codex `/hooks`).
