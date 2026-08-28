# 官方 Hook 安装器

**语言：** 中文 · [English](hooks-maintainer.en.md)

给**本仓库**的贡献者：`hooks/` 如何把 Cursor / Claude Code / Codex / OpenCode 的托管 hook 装进用户主目录。

统计文件契约、以及用户为自己的 Agent 写 hook，见 [Hooks 扩展](hooks-extension.md)。其它 Agent **默认不要**合进本仓库；安装器不是给每种工具各开一个勾选项用的。

改哪些文件：

| 情况 | 改什么 |
| --- | --- |
| 修某个已支持 Agent 的脚本行为 | 只改 `hooks/<id>/` 下的脚本，并跑 `go test ./hooks` |
| 该 Agent 的配置形态已在四种 target 之内，且决定官方支持 | 加 `hooks/<id>/` + `manifest.json` 条目；`install*.ps1/sh` 与 `manage.cjs` 通常不用改 |
| 配置文件形态超出已有四种 target | 才改 `lib/manage.cjs`，并补回归测试 |
| 安装向导要出现新勾选项 | 才改 `build/windows/installer/project.nsi` |

## 目录结构

```
hooks/
├── manifest.json          # Agent 注册表（新增官方 Agent 时必改）
├── install.ps1 / install.sh
├── uninstall.ps1 / uninstall.sh
├── lib/manage.cjs         # 通用安装/卸载逻辑
└── <agentId>/             # 该 Agent 的脚本源码
    └── *.cjs / *.js
```

安装后，用户主目录大致变为：

| 路径（相对 `$HOME` / `%USERPROFILE%`） | 作用 |
| --- | --- |
| `target.hooksJson`（如 `.cursor/hooks.json` / `.codex/hooks.json`） | Cursor 风格 target：合并托管 hook 条目 |
| `target.managedDir`（如 `.cursor/hooks/skillsmanager/<agentId>`） | Cursor / Claude 风格 target：拷贝后的脚本 |
| `target.settingsJson`（如 `.claude/settings.json`） | Claude Code target：合并托管 hook，并保留 `env` 等其它字段 |
| `target.pluginFile`（如 `.config/opencode/plugins/skillsmanager-opencode.js`） | OpenCode 插件 target：投放的单个托管插件 |
| `.skillsmanager/hooks-state.json` | 已安装 Agent 列表（供卸载） |

Cursor / Claude 托管条目通过命令中的前缀 `hooks/skillsmanager/<agentId>` 识别；安装会先剥离旧托管条目再合并，卸载只删托管条目与 `managedDir`，不碰用户自有 hook。Claude Code 的 command 使用本机绝对路径（manifest 里写 `{{managedDir}}`，安装时展开）。OpenCode 使用独立命名的插件文件，安装覆盖该文件，卸载只删除该文件，不读写 `opencode.json` 或用户插件。

## manifest.json 字段

根对象：

| 字段 | 说明 |
| --- | --- |
| `version` | 清单版本，当前为 `1` |
| `agents` | Agent 配置数组 |

每个 Agent：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 唯一 ID，须与目录名 `hooks/<id>/` 一致；安装参数 `-Agent <id>` 用此值 |
| `displayName` | 建议 | 展示名（安装器文案可参考） |
| `defaultSelected` | 否 | 预留给安装器默认勾选 |
| `requires` | 否 | 依赖列表；含 `node` 时 PATH 无 node 则跳过安装（exit `2`） |
| `target.hooksJson` | Cursor / Codex target 必填 | 相对用户主目录的 hooks 配置文件 |
| `target.managedDir` | Cursor / Claude / Codex target 必填 | 相对用户主目录的脚本落地目录 |
| `target.settingsJson` | Claude target 必填 | 相对用户主目录的 Claude Code `settings.json` |
| `target.type` | 否 | `opencode-plugin` / `claude-settings` / `codex-hooks-json`；省略时为现有 Cursor 风格 |
| `target.pluginFile` | OpenCode target 必填 | 相对用户主目录的托管插件文件 |
| `files` | 是 | 从 `hooks/<id>/` 拷贝到 `managedDir`（或插件父目录）的文件名列表 |
| `hooks` | Cursor / Claude / Codex 必填 | 写入配置的事件 → 条目列表 |

`hooks` 条目（Cursor 风格 target）：

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

Cursor target 注意：

- `command` 里的路径是相对 Agent 配置根（Cursor 为 `~/.cursor`），**不是** SkillsManager 安装目录。
- 必须包含子串 `hooks/skillsmanager/<agentId>`，否则安装/卸载无法识别为托管条目。
- `files` 中的每个文件必须真实存在于 `hooks/<id>/`，否则安装失败。
- Cursor skill 统计同时挂三类事件：
  - `preToolUse`（matcher `Read`）与 `beforeReadFile`：统计 Agent 读 `SKILL.md`；前者兜住附带 skill 等绕过 `beforeReadFile` 的读；同一次 Read 的双事件会去重。
  - `beforeSubmitPrompt`（matcher `UserPromptSubmit`）：统计用户 `/skill名` 斜杠调用（内容内联进对话，不走 Read）。
  - 读/写类事件 stdout `{"permission":"allow"}`；`beforeSubmitPrompt` stdout `{"continue":true}`。

参考实现：`hooks/manifest.json` 中的 `cursor` + `hooks/cursor/record-skill-read.cjs`。

Claude Code target（`target.type: "claude-settings"`）示例：

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

Claude target 注意：

- Claude Code 使用嵌套结构：事件 → matcher 组 → `hooks[]`（含 `type`/`command`/`timeout`），与 Cursor 扁平条目不同。
- `command` 必须是本机绝对路径；manifest 写 `{{managedDir}}`，安装时展开为 POSIX 风格绝对路径（如 `C:/Users/.../.claude/hooks/skillsmanager/claude`）。
- 合并时**保留** `settings.json` 中已有的 `env` 等字段；只改 `hooks`。
- `UserPromptExpansion` 统计 `/skill名` 斜杠调用；`PreToolUse` + `Read|Skill` 统计读 `SKILL.md` 或 Skill 工具调用。
- 脚本应始终 exit 0 且 stdout 为空（`UserPromptExpansion` 的 stdout 会进入模型上下文）。

参考实现：`hooks/manifest.json` 中的 `claude` + `hooks/claude/record-skill-read.cjs`。

Codex target（`target.type: "codex-hooks-json"`）示例：

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

Codex target 注意：

- Codex 从 `~/.codex/hooks.json` 读取嵌套结构：事件 → matcher 组 → `hooks[]`，与 Claude Code 的 `settings.json.hooks` 类似。
- `command` 必须是本机绝对路径。安装器把 `{{managedDir}}` 展开为 POSIX 风格绝对路径，例如 `C:/Users/.../.codex/hooks/skillsmanager/codex`。
- `UserPromptSubmit` 统计斜杠 skill 调用。`PreToolUse` 统计 `Skill`、类 Read 工具、MCP 读工具，以及命令里出现 `SKILL.md` 的 Bash / shell。
- 统计脚本必须 exit `0` 且不写 stdout，以免注入模型上下文或挡住工具调用。
- 安装或改定义后，用 Codex `/hooks` 查看并信任该托管 hook。

参考实现：`hooks/manifest.json` 中的 `codex` + `hooks/codex/record-skill-read.cjs`。

OpenCode target 示例：

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

OpenCode 在启动时自动加载 `~/.config/opencode/plugins/` 下直接存放的 `.js` / `.ts` 插件。插件应捕获自身旁路逻辑的异常，避免干扰 Agent 工具调用；安装或卸载后需重启 OpenCode。

## 向本仓库添加官方 Agent（清单）

仅当该 Agent 足够常见、且你愿意跟安装器 / 测试 /（可选）NSIS 一起维护时才走这条路。只想自己用：按 [Hooks 扩展](hooks-extension.md) 在本机注册即可。

### 1. 写脚本

在 `hooks/<agentId>/` 下放置可执行脚本（现有约定为 Node `.cjs`，便于 Windows/macOS/Linux 共用）。脚本必须写入 `~/.skillsmanager/skills/skill-usage.json`，格式见用户文档。

硬约束：

- 从 stdin 或 argv 读 Agent 传入的 JSON payload，解析失败时静默退出。
- 业务失败只写 stderr，不要因统计阻断 Agent 主流程。
- Cursor / Claude / Codex 的 stdout 约定见上文各 target 注意。

### 2. 注册 manifest

在 `hooks/manifest.json` 的 `agents` 中追加条目：填好 `id`、`target`、`files`、`hooks`。`install*.ps1/sh` 与 `manage.cjs` **通常不用改**——它们按 `--agent <id>` 查表安装。

### 3. 本地验证

```powershell
# Windows
.\hooks\install.ps1 -Agent <agentId>
.\hooks\uninstall.ps1 -Agent <agentId>
# 或一次卸掉全部托管 Agent
.\hooks\uninstall.ps1 -All
```

```bash
# macOS / Linux
./hooks/install.sh --agent <agentId>
./hooks/uninstall.sh --agent <agentId>
./hooks/uninstall.sh --all
```

检查：

1. `managedDir` 下脚本已拷贝。
2. `hooksJson` 已合并事件，且用户原有条目仍在。
3. 再装一次应幂等（不重复堆叠托管条目）。
4. 卸载后托管目录与托管条目消失，用户自有条目保留。

自动化回归见 `hooks/install_test.go`、`hooks/uninstall_test.go`（可仿照 `cursor` / `claude` 用例加新 Agent）。

### 4. 可选：NSIS 安装组件

仅当你希望 `wails build -nsis` 的安装向导出现新勾选项时，才改 `build/windows/installer/project.nsi`：

1. `SecApp` 里增加 `File`，把 `hooks/<agentId>/` 下文件打进 `$INSTDIR\hooks\<agentId>\`。
2. 新增 `Section "<DisplayName>" SecXxxHooks`，调用  
   `install.ps1 -Agent <agentId>`。
3. 补充 `LangString DESC_...` 与 `MUI_DESCRIPTION_TEXT`。

只打算安装后手动跑 `hooks/install.*` 时，可跳过本步；但 `SecApp` 仍建议把新脚本文件打进安装目录，否则用户机器上没有源文件可装。

## 何时需要改 `manage.cjs`

`lib/manage.cjs` 支持四种 target 约定：

- Cursor 默认：根对象含 `version` 与 `hooks`；扁平托管条目靠 `command` 里的 `hooks/skillsmanager/<agentId>` 识别。
- `target.type: "claude-settings"`：读写完整 `settings.json`，保留非 hook 键；嵌套 matcher 组把 `{{managedDir}}` 展开为绝对路径。
- `target.type: "codex-hooks-json"`：读写 `~/.codex/hooks.json`，嵌套 matcher 组形态与 Claude Code 相同。
- `target.type: "opencode-plugin"`：把 `files` 拷到 `target.pluginFile` 的父目录；卸载只删那一个文件。

仅当某个 Agent 使用不同的注册机制或配置文件形态时，才扩展 `installAgent` / `uninstallAgent` 并补回归测试。

## 退出码约定

| 码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 缺少 `node`（或 Agent `requires` 未满足），跳过安装 |
| 其它非零 | 配置错误 / 缺文件等真实失败 |

NSIS 中对 exit `2` 按「跳过」处理，不视为安装失败。
