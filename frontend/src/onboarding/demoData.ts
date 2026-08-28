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

export const DEMO_ORGANIZE_ACTIONS = [
  {
    type: 'move_to_hub',
    label: '迁入源仓',
    skillId: 'code-review',
    sources: [String.raw`C:\Users\Administrator\.cursor\skills\code-review`],
    selected: true,
  },
  {
    type: 'move_to_hub',
    label: '迁入源仓',
    skillId: 'commit-msg',
    sources: [String.raw`C:\Users\Administrator\.claude\skills\commit-msg`],
    selected: true,
  },
  {
    type: 'replace_with_symlink',
    label: '替换为链接',
    skillId: 'pr-review',
    sources: [String.raw`C:\Users\Administrator\.codex\skills\pr-review`],
    selected: true,
  },
] as const

/** After a successful demo execute, the re-scan shows everything as skip. */
export const DEMO_ORGANIZE_SKIPPED = DEMO_ORGANIZE_ACTIONS.map((action) => ({
  ...action,
  type: 'skip' as const,
  label: '跳过',
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
    name: 'code-review',
    description: '按仓库规范做代码审查',
    group: 'default',
    status: 'normal',
    language: 'zh-CN',
    tools: ['cursor'],
    usage: 0,
  },
  {
    id: 'commit-msg',
    name: 'commit-msg',
    description: '按约定生成提交说明',
    group: 'default',
    status: 'normal',
    language: 'zh-CN',
    tools: ['claude'],
    usage: 0,
  },
  {
    id: 'pr-review',
    name: 'pr-review',
    description: '检查 Pull Request 是否可合并',
    group: '工作流',
    status: 'normal',
    language: 'zh-CN',
    tools: ['codex'],
    usage: 0,
  },
] as const
