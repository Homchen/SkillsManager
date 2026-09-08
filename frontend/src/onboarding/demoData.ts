export const DEMO_HUB_PATH = String.raw`C:\Users\Administrator\.skillsmanager\skills`

export const DEMO_BULK_TOOLS = [
  {
    id: 'cursor',
    path: String.raw`C:\Users\Administrator\.cursor\skills`,
    links: 0,
    copies: 0,
    snapshot: '无快照',
    selected: true,
  },
  {
    id: 'claude',
    path: String.raw`C:\Users\Administrator\.claude\skills`,
    links: 0,
    copies: 0,
    snapshot: '无快照',
    selected: false,
  },
  {
    id: 'agents',
    path: String.raw`C:\Users\Administrator\.agents\skills`,
    links: 0,
    copies: 0,
    snapshot: '无快照',
    selected: false,
  },
  {
    id: 'opencode',
    path: String.raw`C:\Users\Administrator\.config\opencode\skills`,
    links: 0,
    copies: 0,
    snapshot: '无快照',
    selected: false,
  },
] as const

export const DEMO_SETTINGS_TOOLS = [
  {
    id: 'cursor',
    path: String.raw`C:\Users\Administrator\.cursor\skills`,
    enabled: true,
  },
  {
    id: 'claude',
    path: String.raw`C:\Users\Administrator\.claude\skills`,
    enabled: true,
  },
] as const

export const DEMO_ORGANIZE_ACTIONS = [
  {
    type: 'move_to_hub',
    label: '待迁入源仓',
    skillId: 'code-review',
    toolId: 'cursor',
    sources: [String.raw`C:\Users\Administrator\.cursor\skills\code-review`],
    selected: true,
  },
  {
    type: 'move_to_hub',
    label: '待迁入源仓',
    skillId: 'commit-msg',
    toolId: 'claude',
    sources: [String.raw`C:\Users\Administrator\.claude\skills\commit-msg`],
    selected: true,
  },
  {
    type: 'replace_with_symlink',
    label: '待替换软链',
    skillId: 'pr-review',
    toolId: 'codex',
    sources: [String.raw`C:\Users\Administrator\.codex\skills\pr-review`],
    selected: true,
  },
] as const

/** After a successful demo execute, the re-scan shows everything as skip. */
export const DEMO_ORGANIZE_SKIPPED = DEMO_ORGANIZE_ACTIONS.map((action) => ({
  ...action,
  type: 'skip' as const,
  label: '保持跳过',
  selected: false,
}))

export const DEMO_ORGANIZE_REPORT = {
  succeeded: [
    {skillId: 'code-review', message: '已迁入源仓并替换为链接'},
    {skillId: 'commit-msg', message: '已迁入源仓并替换为链接'},
    {skillId: 'pr-review', message: '已替换为链接'},
  ],
  skipped: [] as {skillId: string; message: string}[],
  failed: [] as {skillId: string; message: string}[],
}

export const DEMO_SKILLS = [
  {
    id: 'code-review',
    name: '代码审查',
    description: '按仓库规范做代码审查',
    group: 'default',
    status: 'normal',
    language: 'zh-CN',
    translationCount: 1,
    tools: ['cursor'],
    usage: 42,
    lastUsedAt: '2026-09-08T04:12:00.000Z',
  },
  {
    id: 'commit-msg',
    name: '提交说明',
    description: '按约定生成提交说明',
    group: 'default',
    status: 'normal',
    language: 'zh-CN',
    translationCount: 0,
    tools: ['claude'],
    usage: 18,
    lastUsedAt: '2026-09-07T09:40:00.000Z',
  },
  {
    id: 'pr-review',
    name: 'PR 检查',
    description: '检查 Pull Request 是否可合并',
    group: '工作流',
    status: 'normal',
    language: 'zh-CN',
    translationCount: 0,
    tools: ['codex'],
    usage: 7,
    lastUsedAt: '2026-09-06T11:05:00.000Z',
  },
] as const

export type DemoSkill = {
  id: string
  name: string
  description: string
  group: string
  status: string
  language: string
  translationCount: number
  tools: readonly string[]
  usage: number
  lastUsedAt: string
}

export const DEMO_USAGE_POINTS = [
  {date: '2026-09-02', count: 4},
  {date: '2026-09-03', count: 7},
  {date: '2026-09-04', count: 5},
  {date: '2026-09-05', count: 11},
  {date: '2026-09-06', count: 8},
  {date: '2026-09-07', count: 14},
  {date: '2026-09-08', count: 18},
]
