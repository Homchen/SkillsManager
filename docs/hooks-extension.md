# Hooks 扩展

**语言：** 中文 · [English](hooks-extension.en.md)

给使用 SkillsManager 的人：为自己的 Agent 工具写一份 hook，让「使用统计」也能记下那个工具上的 skill 调用。

本仓库**不会**把每一种 Agent 的 hook 都收进来。安装器只内置 Cursor、Claude Code、Codex、OpenCode。其它工具请在本机自行编写、自行注册；不必向本仓库提「再加一个 Agent」的 PR。

要改本仓库里的官方安装器、`manifest.json` 或 NSIS 勾选项，见 [官方 Hook 安装器](hooks-maintainer.md)。

## Hooks 在本产品中的作用

SkillsManager **不监听** Agent 进程，也不要求本应用正在运行。它只读源仓里的一份统计文件：

`~/.skillsmanager/skills/skill-usage.json`  
（Windows：`%USERPROFILE%\.skillsmanager\skills\skill-usage.json`）

Hook 的全部职责：在 Agent 读取 `SKILL.md`、调用 Skill 工具、或用户输入 `/skill名` 时，把对应 skill 的计数写进这份文件。下次打开应用的「使用统计」页，就会显示出来。

```
Agent 事件（读 SKILL.md / Skill 工具 / /skill）
        │
        ▼
  你的 hook（旁路，不要打断 Agent）
        │
        ▼
  skill-usage.json     ← 本产品唯一的统计契约
        │
        ▼
  SkillsManager「使用统计」
```

源仓里的技能正文仍是 `~/.skillsmanager/skills`。Hook 只追加统计，不改技能文件，也不依赖 Wails 前端。

## 统计文件格式

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

| 字段 | 作用 |
| --- | --- |
| `version` | 当前为 `2` |
| `skills` 的键 | skill id，一般是 `SKILL.md` 所在目录名，与源仓 `hub/<group>/<skill-id>/` 中的 `<skill-id>` 一致 |
| `count` | 累计次数 |
| `lastUsedAt` | 最近一次，ISO 8601 |
| `paths` | 可选。应用会用这些路径把记录对上已管理的 skill（当键不是精确 id 时尤其有用） |
| `daily` | 可选。键为本地日期 `YYYY-MM-DD`，值为当天次数 |

应用只展示**当前已管理**的 skill。匹配顺序：键等于已管理 id → 否则看 `paths` 是否指向该 skill 目录或 `SKILL.md` → 翻译副本路径 `skills_translation/<skill-id>/...` 也可对上。对不上的记录会被忽略，不会弄乱界面。

应用会忽略它不认识的字段（例如 `lastSource`）。读写时保留已有键，不要整文件覆盖成只有自己写的那一条。

多个 Agent 可能同时写这份文件。参考实现使用旁边的 `skill-usage.json.lock`（独占创建）和「写临时文件再改名」的原子替换。自己写时请同样处理并发，否则计数会丢。

## 为自己的 Agent 写 hook

1. 查该 Agent 如何注册 hook / 插件（配置文件、事件名、stdin 里的 JSON 形态各不相同）。
2. 在「读到 `SKILL.md`、调用 Skill 工具、或用户斜杠调用 skill」时，按上一节格式更新 `skill-usage.json`。
3. 把脚本注册到**该 Agent 自己的配置**里，不要改 SkillsManager 安装目录，也不要改本仓库的 `hooks/manifest.json`。
4. 用一次真实的 skill 调用验证：文件里对应 id 的 `count` 增加，「使用统计」页能看到。

可直接抄内置脚本的写文件逻辑：

| Agent | 参考 |
| --- | --- |
| Cursor | `hooks/cursor/record-skill-read.cjs` |
| Claude Code | `hooks/claude/record-skill-read.cjs` |
| Codex | `hooks/codex/record-skill-read.cjs` |
| OpenCode | `hooks/opencode/skillsmanager-opencode.js` |

语言不限。只要最终写入同一份 JSON，应用就能读到。

**必须做到：**

- 失败不得阻断 Agent：解析失败就静默退出；业务失败只写 stderr。
- 不要假设 SkillsManager 正在运行。
- 若该 Agent 会把 hook 的 stdout 塞进模型上下文（如 Claude 的 `UserPromptExpansion`），stdout 必须为空。
- 不要使用命令子串 `hooks/skillsmanager/<id>`。那是本产品安装器识别**官方托管条目**的标记；用了之后，官方卸载可能把你的 hook 一起拆掉。

**建议：**

- 从 stdin 或 argv 读 Agent 传入的 JSON。
- skill id：普通副本用 `SKILL.md` 的父目录名；翻译副本用 `skills_translation/<skill-id>/<语言>/SKILL.md` 中的 `<skill-id>`。
- 能拿到文件路径时写入 `paths`，方便应用对上源仓里的 skill。

常见注册位置（以各工具文档为准）：

| 工具 | 典型落点 |
| --- | --- |
| Cursor | `~/.cursor/hooks.json` |
| Claude Code | `~/.claude/settings.json` 的 `hooks` |
| Codex | `~/.codex/hooks.json` |
| OpenCode | `~/.config/opencode/plugins/` 下的 `.js` / `.ts` |

改完后按该工具的要求重启或重新信任 hook（例如 Codex 的 `/hooks`）。
