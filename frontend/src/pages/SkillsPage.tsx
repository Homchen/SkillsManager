import {useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react'
import {
  CreateGroup,
  CreateSkill,
  DeleteGroup,
  DeleteSkill,
  DisableAllSkillLinks,
  EnableSkillLinks,
  GetConfig,
  GetLinkSnapshot,
  GetSkillUsageSummary,
  ImportSkills,
  IsElevated,
  ListGroups,
  ListSkills,
  ListTrash,
  OpenFolder,
  PurgeTrash,
  RenameGroup,
  RenameSkill,
  RestoreTrash,
  SetCollapsedSkillGroups,
  SetSkillsLayout,
  SetSkillGroup,
  SetSkillLink,
} from '../../wailsjs/go/main/App'
import {ClipboardSetText, OnFileDrop, OnFileDropOff} from '../../wailsjs/runtime/runtime'
import {AppToast, useAppToast} from '../components/AppToast'
import {
  IconBulkToolLinks,
  IconCheck,
  IconChevron,
  IconCopy,
  IconFolderPlus,
  IconFolderSync,
  IconLayoutGrid,
  IconLayoutList,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '../components/icons'
import {
  DEFAULT_GROUP_ID,
  groupDisplayName,
  STATUS_LABELS,
  type BulkLinkResult,
  type GroupInfo,
  type ImportSkillsResult,
  type LinkSnapshot,
  type SkillEntry,
  type SkillsLayout,
  type SkillUsageItem,
  type ToolMapping,
  type TrashItem,
} from '../types'
import {languageLabel, SKILL_LANGUAGES} from '../lib/languages'
import {formatUsageLabel} from '../lib/skillUsage'

function parseSkillsLayout(value: unknown): SkillsLayout {
  return value === 'grouped' ? 'grouped' : 'flat'
}

type Props = {
  onOpenEditor: (skillId: string) => void
  onOrganize: () => void
  /** 递增时重新拉取列表（例如从一键整理返回） */
  reloadToken?: number
  /** 当前是否为技能页可见状态（用于启停拖入导入） */
  active?: boolean
}

function linkedToolIds(skill: SkillEntry): string[] {
  const ids = new Set<string>()
  for (const loc of skill.locations ?? []) {
    if (loc.kind === 'symlink' || loc.kind === 'real_copy' || loc.kind === 'broken_link') {
      ids.add(loc.toolId)
    }
  }
  return [...ids]
}

function hasSymlink(skill: SkillEntry, toolId: string): boolean {
  return (skill.locations ?? []).some(
    (loc) => loc.toolId === toolId && (loc.kind === 'symlink' || loc.kind === 'broken_link'),
  )
}

function toolLinkStats(
  skills: SkillEntry[],
  toolId: string,
): {links: number; copies: number} {
  let links = 0
  let copies = 0
  for (const skill of skills) {
    for (const loc of skill.locations ?? []) {
      if (loc.toolId !== toolId) continue
      if (loc.kind === 'symlink' || loc.kind === 'broken_link') links++
      else if (loc.kind === 'real_copy') copies++
    }
  }
  return {links, copies}
}

function snapshotLabel(snap: LinkSnapshot | null | undefined): string {
  if (!snap || !(snap.count > 0)) return '无快照'
  const when = new Date(snap.savedAt).toLocaleString()
  if (Number.isNaN(new Date(snap.savedAt).getTime())) {
    return `上次禁用了 ${snap.count} 个`
  }
  return `上次于 ${when} 禁用了 ${snap.count} 个`
}

/** 按已选目录当前链接覆盖率推断默认操作：已大多启用 → 禁用；否则 → 启用 */
function inferBulkAction(
  skills: SkillEntry[],
  selectedToolIds: string[],
): 'enable' | 'disable' {
  if (selectedToolIds.length === 0) return 'enable'
  const hubCount = skills.filter((s) => s.hubPath).length
  let totalLinks = 0
  for (const id of selectedToolIds) {
    totalLinks += toolLinkStats(skills, id).links
  }
  if (totalLinks === 0) return 'enable'
  const capacity = hubCount * selectedToolIds.length
  if (capacity > 0 && totalLinks / capacity >= 0.5) return 'disable'
  return 'enable'
}

function formatBulkResultSummary(
  result: BulkLinkResult,
  action: 'enable' | 'disable',
): string {
  const t = result.totals ?? {linked: 0, removed: 0, skipped: 0, failed: 0}
  if (action === 'disable') {
    return `禁用完成：移除 ${t.removed} 个链接 · 跳过 ${t.skipped} · 失败 ${t.failed}`
  }
  return `启用完成：新建/修复 ${t.linked} 个链接 · 跳过 ${t.skipped} · 失败 ${t.failed}`
}

type GroupSection = {id: string; skills: SkillEntry[]}

function formatImportFailureMessage(res: ImportSkillsResult): string {
  const failed = res.failed ?? 0
  const failItems = (res.items ?? []).filter((i) => i.status === 'failed')
  const first = failItems[0]
  const detail = first?.reason || first?.id || '导入失败'
  if (failed <= 1) return detail
  return `${detail}（共 ${failed} 项失败）`
}

/** 与分组列表一致：默认置顶，其余按中文 locale 排序 */
function sortGroupsForDisplay(groups: GroupInfo[]): GroupInfo[] {
  const custom = groups
    .filter((g) => g.id !== DEFAULT_GROUP_ID)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id, 'zh'))
  const def = groups.find((g) => g.id === DEFAULT_GROUP_ID)
  return def ? [def, ...custom] : custom
}

function buildSections(
  groups: GroupInfo[],
  skills: SkillEntry[],
  query: string,
): GroupSection[] {
  const q = query.trim().toLowerCase()
  const match = (s: SkillEntry) =>
    !q ||
    s.name.toLowerCase().includes(q) ||
    s.id.toLowerCase().includes(q)
  const ordered = sortGroupsForDisplay(groups)
  const sections: GroupSection[] = []
  for (const g of ordered) {
    const list = skills.filter((s) => (s.group || DEFAULT_GROUP_ID) === g.id && match(s))
    // 默认分组空则不显示；搜索时无匹配的自定义分组也跳过
    if (g.id === DEFAULT_GROUP_ID) {
      if (list.length > 0) sections.push({id: g.id, skills: list})
      continue
    }
    if (q && list.length === 0) continue
    sections.push({id: g.id, skills: list})
  }
  return sections
}

export default function SkillsPage({
  onOpenEditor,
  onOrganize,
  reloadToken = 0,
  active = true,
}: Props) {
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [usageById, setUsageById] = useState<Record<string, SkillUsageItem>>({})
  const [groups, setGroups] = useState<GroupInfo[]>([])
  const [tools, setTools] = useState<ToolMapping[]>([])
  const [layout, setLayout] = useState<SkillsLayout>('flat')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  /** 搜索期间临时折起的分组（不写配置） */
  const [searchCollapseOverride, setSearchCollapseOverride] = useState<Set<string>>(
    () => new Set(),
  )
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createId, setCreateId] = useState('')
  const [createName, setCreateName] = useState('')
  const [createGroup, setCreateGroup] = useState(DEFAULT_GROUP_ID)
  const [createLanguage, setCreateLanguage] = useState('zh-CN')
  const [createLanguageMenuOpen, setCreateLanguageMenuOpen] = useState(false)
  const [createGroupMenuOpen, setCreateGroupMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const createGroupMenuRef = useRef<HTMLDivElement | null>(null)
  const createLanguageMenuRef = useRef<HTMLDivElement | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignSkill, setAssignSkill] = useState<SkillEntry | null>(null)
  const [assignBatch, setAssignBatch] = useState(false)
  const [assignSelected, setAssignSelected] = useState(DEFAULT_GROUP_ID)
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [createGroupName, setCreateGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [createGroupError, setCreateGroupError] = useState('')
  const [renameGroupOpen, setRenameGroupOpen] = useState(false)
  const [renameGroupId, setRenameGroupId] = useState('')
  const [renameGroupName, setRenameGroupName] = useState('')
  const [renamingGroup, setRenamingGroup] = useState(false)
  const [renameGroupError, setRenameGroupError] = useState('')
  const [actionsVisibleGroupId, setActionsVisibleGroupId] = useState<string | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameSkill, setRenameSkill] = useState<SkillEntry | null>(null)
  const [renameId, setRenameId] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState('')
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashItems, setTrashItems] = useState<TrashItem[]>([])
  const [trashLoading, setTrashLoading] = useState(false)
  const [trashError, setTrashError] = useState('')
  const [enableOpen, setEnableOpen] = useState(false)
  const [enableSkill, setEnableSkill] = useState<SkillEntry | null>(null)
  const [enableSelected, setEnableSelected] = useState<Set<string>>(new Set())
  const [enabling, setEnabling] = useState(false)
  const [enableError, setEnableError] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkStep, setBulkStep] = useState<1 | 2>(1)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<'enable' | 'disable'>('enable')
  const [bulkMode, setBulkMode] = useState<'all' | 'restore'>('restore')
  const [bulkSnapshots, setBulkSnapshots] = useState<Record<string, LinkSnapshot | null>>({})
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState('')
  const [bulkResult, setBulkResult] = useState<BulkLinkResult | null>(null)
  const [bulkConfirm, setBulkConfirm] = useState<string | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchEnableOpen, setBatchEnableOpen] = useState(false)
  const [batchEnableTools, setBatchEnableTools] = useState<Set<string>>(new Set())
  const [batchEnabling, setBatchEnabling] = useState(false)
  const [batchEnableError, setBatchEnableError] = useState('')
  const [importing, setImporting] = useState(false)
  /** 外部文件拖入页面期间（尚未松开） */
  const [fileDragOver, setFileDragOver] = useState(false)
  const [importReport, setImportReport] = useState<ImportSkillsResult | null>(null)
  const {toast, showToast, dismissToast} = useAppToast()
  const [confirmDialog, setConfirmDialog] = useState<
    | {kind: 'delete-skill'; skill: SkillEntry}
    | {kind: 'delete-skills-batch'}
    | {kind: 'delete-group'; groupId: string}
    | {kind: 'restore-overwrite'; item: TrashItem}
    | {kind: 'purge-trash'; item: TrashItem}
    | null
  >(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [copiedSkillId, setCopiedSkillId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const copyFeedbackTimer = useRef<number | null>(null)
  const listAreaRef = useRef<HTMLDivElement | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const longPressOrigin = useRef<{x: number; y: number} | null>(null)
  const suppressClickRef = useRef(false)
  const groupActionsTimer = useRef<number | null>(null)
  const marqueeRef = useRef<{
    pointerId: number
    /** pointerdown 时的视口坐标 */
    originX: number
    originY: number
    originScrollLeft: number
    originScrollTop: number
    /** 最近一次指针视口坐标（滚轮滚动时仍用它更新选区） */
    currentX: number
    currentY: number
    active: boolean
    wasSelectMode: boolean
    baseSelected: Set<string>
    additive: boolean
  } | null>(null)
  const [marqueeBox, setMarqueeBox] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const [marqueeHitIds, setMarqueeHitIds] = useState<Set<string> | null>(null)

  const LONG_PRESS_MS = 500
  const MOVE_THRESHOLD_PX = 8
  const GROUP_ACTIONS_HIDE_MS = 2500

  const loadGenRef = useRef(0)
  const load = useCallback(async () => {
    const gen = ++loadGenRef.current
    setError('')
    try {
      const [list, cfg, groupList, usage] = await Promise.all([
        ListSkills(),
        GetConfig(),
        ListGroups(),
        GetSkillUsageSummary().catch(() => null),
      ])
      if (gen !== loadGenRef.current) return
      const groupsList = (groupList ?? []) as GroupInfo[]
      setSkills((list ?? []) as SkillEntry[])
      const usageMap: Record<string, SkillUsageItem> = {}
      for (const item of usage?.skills ?? []) {
        if (item?.id) usageMap[item.id] = item as SkillUsageItem
      }
      setUsageById(usageMap)
      setGroups(groupsList)
      setTools((cfg?.tools ?? []) as ToolMapping[])
      setLayout(parseSkillsLayout(cfg?.skillsLayout))

      const valid = new Set(groupsList.map((g) => g.id))
      const raw = (cfg?.collapsedSkillGroups ?? []).filter(
        (id): id is string => typeof id === 'string' && id.trim() !== '',
      )
      const pruned = raw.filter((id) => valid.has(id))
      setCollapsedGroups(new Set(pruned))
      if (pruned.length !== raw.length) {
        try {
          await SetCollapsedSkillGroups(pruned)
        } catch {
          // 清理失败不阻断列表加载
        }
      }
    } catch (e) {
      if (gen !== loadGenRef.current) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (gen === loadGenRef.current) {
        setLoading(false)
      }
    }
  }, [])

  async function persistCollapsedGroups(next: Set<string>) {
    try {
      await SetCollapsedSkillGroups([...next])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function isGroupCollapsed(groupId: string, skillCount: number): boolean {
    if (query.trim()) {
      // 搜索时：有匹配的组默认展开；仅尊重临时折起
      if (skillCount > 0) return searchCollapseOverride.has(groupId)
      return false
    }
    return collapsedGroups.has(groupId)
  }

  function toggleGroupCollapse(groupId: string) {
    if (query.trim()) {
      // 仅临时覆盖；无匹配空组不进入此路径也无妨
      setSearchCollapseOverride((prev) => {
        const next = new Set(prev)
        if (next.has(groupId)) next.delete(groupId)
        else next.add(groupId)
        return next
      })
      return
    }
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      void persistCollapsedGroups(next)
      return next
    })
  }

  async function toggleLayout() {
    const next: SkillsLayout = layout === 'flat' ? 'grouped' : 'flat'
    setLayout(next)
    try {
      await SetSkillsLayout(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void load()
  }, [load, reloadToken])

  useEffect(() => {
    if (!query.trim()) {
      setSearchCollapseOverride(new Set())
    }
  }, [query])

  const importingRef = useRef(false)
  const handleImportPaths = useCallback(async (paths: string[]) => {
    const validPaths = paths.filter((p) => p.trim() !== '')
    if (validPaths.length === 0) {
      showToast({message: '未收到有效文件', tone: 'error'})
      return
    }
    if (importingRef.current) return
    importingRef.current = true
    setImporting(true)
    setError('')
    try {
      const res = (await ImportSkills(validPaths)) as ImportSkillsResult
      const report: ImportSkillsResult = {
        imported: res.imported ?? 0,
        skipped: res.skipped ?? 0,
        failed: res.failed ?? 0,
        items: res.items ?? [],
      }
      setImportReport(report)
      if (report.failed > 0) {
        showToast({message: formatImportFailureMessage(report), tone: 'error'})
      } else if (report.imported === 0 && report.skipped > 0) {
        const skipped = report.items.find((i) => i.status === 'skipped')
        showToast({
          message: skipped?.reason
            ? `已跳过：${skipped.reason}`
            : `已跳过 ${report.skipped} 项`,
          tone: 'warn',
        })
      } else if (report.imported > 0) {
        showToast({message: `成功导入 ${report.imported} 个 skill`, tone: 'success'})
      }
      if (report.imported > 0) {
        await load()
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      showToast({message, tone: 'error'})
    } finally {
      importingRef.current = false
      setImporting(false)
    }
  }, [load, showToast])

  useEffect(() => {
    if (!active) {
      OnFileDropOff()
      setFileDragOver(false)
      return
    }

    let dragDepth = 0
    const isFileDrag = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files')

    const clearFileDrag = () => {
      dragDepth = 0
      setFileDragOver(false)
    }

    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      dragDepth += 1
      setFileDragOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      dragDepth = Math.max(0, dragDepth - 1)
      if (dragDepth === 0) setFileDragOver(false)
    }
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      if (dragDepth === 0) {
        dragDepth = 1
        setFileDragOver(true)
      }
    }
    const onDropOrEnd = () => clearFileDrag()

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDropOrEnd)
    window.addEventListener('dragend', onDropOrEnd)

    OnFileDrop((_x, _y, paths) => {
      clearFileDrag()
      if (!paths || paths.length === 0) return
      void handleImportPaths(paths)
    }, true)

    return () => {
      OnFileDropOff()
      clearFileDrag()
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDropOrEnd)
      window.removeEventListener('dragend', onDropOrEnd)
    }
  }, [active, handleImportPaths])

  function clearGroupActionsTimer() {
    if (groupActionsTimer.current != null) {
      window.clearTimeout(groupActionsTimer.current)
      groupActionsTimer.current = null
    }
  }

  function scheduleHideGroupActions() {
    if (groupActionsTimer.current != null) return
    groupActionsTimer.current = window.setTimeout(() => {
      setActionsVisibleGroupId(null)
      groupActionsTimer.current = null
    }, GROUP_ACTIONS_HIDE_MS)
  }

  function showGroupActions(groupId: string) {
    clearGroupActionsTimer()
    setActionsVisibleGroupId(groupId)
    groupActionsTimer.current = window.setTimeout(() => {
      setActionsVisibleGroupId(null)
      groupActionsTimer.current = null
    }, GROUP_ACTIONS_HIDE_MS)
  }

  useEffect(() => {
    if (layout !== 'grouped') {
      clearGroupActionsTimer()
      setActionsVisibleGroupId(null)
    }
    return () => clearGroupActionsTimer()
  }, [layout])

  useEffect(() => {
    if (!openMenuId) return
    const onDoc = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setOpenMenuId(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [openMenuId])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
    setBatchEnableOpen(false)
    setBatchEnableError('')
    setBatchEnableTools(new Set())
    setAssignOpen(false)
    setAssignSkill(null)
    setAssignBatch(false)
    setAssignError('')
  }, [])

  useEffect(() => {
    if (!selectMode) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      if (
        batchEnableOpen ||
        batchEnabling ||
        assignOpen ||
        assigning ||
        confirmDialog ||
        confirmBusy
      ) {
        return
      }
      exitSelectMode()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [
    selectMode,
    batchEnableOpen,
    batchEnabling,
    assignOpen,
    assigning,
    confirmDialog,
    confirmBusy,
    exitSelectMode,
  ])

  const linkableTools = useMemo(
    () => tools.filter((t) => t.enabled && !t.isHub),
    [tools],
  )

  const canRestoreBulk = useMemo(
    () => [...bulkSelected].some((id) => (bulkSnapshots[id]?.count ?? 0) > 0),
    [bulkSelected, bulkSnapshots],
  )

  useEffect(() => {
    if (bulkMode === 'restore' && !canRestoreBulk) {
      setBulkMode('all')
    }
  }, [bulkMode, canRestoreBulk])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(
      (s) => s.id.toLowerCase().includes(q) || (s.name ?? '').toLowerCase().includes(q),
    )
  }, [skills, query])

  const sections = useMemo(
    () => buildSections(groups, skills, query),
    [groups, skills, query],
  )

  const sortedGroups = useMemo(() => sortGroupsForDisplay(groups), [groups])

  function clearLongPressTimer() {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    longPressOrigin.current = null
  }

  function enterSelectMode(skillId: string) {
    suppressClickRef.current = true
    setOpenMenuId(null)
    setSelectMode(true)
    setSelectedIds(new Set([skillId]))
  }

  function toggleSelect(skillId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(skillId)) next.delete(skillId)
      else next.add(skillId)
      return next
    })
  }

  function toggleSelectIds(ids: string[]) {
    if (ids.length === 0) return
    const allSelected = ids.every((id) => selectedIds.has(id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const id of ids) next.delete(id)
      } else {
        for (const id of ids) next.add(id)
      }
      return next
    })
  }

  function toggleSelectAllFiltered() {
    toggleSelectIds(filtered.map((s) => s.id))
  }

  function toggleSelectAllInGroup(groupSkills: SkillEntry[]) {
    toggleSelectIds(groupSkills.map((s) => s.id))
  }

  function isMarqueeStartTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    if (
      target.closest(
        'button, a, input, textarea, select, label, .card-menu, .dialog-backdrop, .page-sticky-header, .select-action-bar',
      )
    ) {
      return false
    }
    if (target.closest('.skill-card')) return false
    return Boolean(target.closest('.skills-list-area'))
  }

  function normalizeMarqueeBox(x0: number, y0: number, x1: number, y1: number) {
    const left = Math.min(x0, x1)
    const top = Math.min(y0, y1)
    const width = Math.abs(x1 - x0)
    const height = Math.abs(y1 - y0)
    return {left, top, width, height, right: left + width, bottom: top + height}
  }

  function getMarqueeScrollEl(): HTMLElement | null {
    const root = listAreaRef.current
    if (!root) return null
    return (root.closest('.app-main') as HTMLElement | null) ?? root
  }

  /** 将起点换算到「当前滚动」下的视口坐标，使滚轮滚动后选区能覆盖滚过的内容 */
  function marqueeViewportOrigin(session: NonNullable<typeof marqueeRef.current>) {
    const scrollEl = getMarqueeScrollEl()
    const scrollLeft = scrollEl?.scrollLeft ?? 0
    const scrollTop = scrollEl?.scrollTop ?? 0
    return {
      x: session.originX + session.originScrollLeft - scrollLeft,
      y: session.originY + session.originScrollTop - scrollTop,
    }
  }

  function hitSkillIdsInBox(box: {left: number; top: number; right: number; bottom: number}) {
    const root = listAreaRef.current
    if (!root) return [] as string[]
    const ids: string[] = []
    root.querySelectorAll<HTMLElement>('[data-skill-id]').forEach((el) => {
      const id = el.dataset.skillId
      if (!id) return
      const r = el.getBoundingClientRect()
      if (
        r.left < box.right &&
        r.right > box.left &&
        r.top < box.bottom &&
        r.bottom > box.top
      ) {
        ids.push(id)
      }
    })
    return ids
  }

  function resolveMarqueeSelection(
    hits: string[],
    session: NonNullable<typeof marqueeRef.current>,
  ) {
    return session.additive
      ? new Set([...session.baseSelected, ...hits])
      : new Set(hits)
  }

  const syncMarqueeFromSession = useCallback(() => {
    const session = marqueeRef.current
    if (!session) return

    const origin = marqueeViewportOrigin(session)
    const dx = session.currentX - origin.x
    const dy = session.currentY - origin.y
    if (!session.active) {
      if (dx * dx + dy * dy <= MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX) return
      session.active = true
      suppressClickRef.current = true
      document.body.classList.add('is-marquee-selecting')
    }

    const box = normalizeMarqueeBox(
      origin.x,
      origin.y,
      session.currentX,
      session.currentY,
    )
    setMarqueeBox({
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    })
    setMarqueeHitIds(resolveMarqueeSelection(hitSkillIdsInBox(box), session))
  }, [])

  const marqueeScrollHandlerRef = useRef(syncMarqueeFromSession)
  marqueeScrollHandlerRef.current = syncMarqueeFromSession

  const onMarqueeScroll = useCallback(() => {
    marqueeScrollHandlerRef.current()
  }, [])

  function endMarqueeSession(el: HTMLElement | null, pointerId: number) {
    const scrollEl = getMarqueeScrollEl()
    if (scrollEl) {
      scrollEl.removeEventListener('scroll', onMarqueeScroll)
    }
    marqueeRef.current = null
    setMarqueeBox(null)
    setMarqueeHitIds(null)
    document.body.classList.remove('is-marquee-selecting')
    if (el?.hasPointerCapture(pointerId)) {
      el.releasePointerCapture(pointerId)
    }
  }

  function onListAreaPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    // 触控保留长按多选与滚动；框选仅鼠标/笔
    if (e.pointerType === 'touch') return
    if (batchEnabling || assigning || confirmBusy) return
    if (!isMarqueeStartTarget(e.target)) return

    clearLongPressTimer()
    setOpenMenuId(null)
    const scrollEl = getMarqueeScrollEl()
    marqueeRef.current = {
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      originScrollLeft: scrollEl?.scrollLeft ?? 0,
      originScrollTop: scrollEl?.scrollTop ?? 0,
      currentX: e.clientX,
      currentY: e.clientY,
      active: false,
      wasSelectMode: selectMode,
      baseSelected: new Set(selectedIds),
      additive: e.ctrlKey || e.metaKey,
    }
    scrollEl?.addEventListener('scroll', onMarqueeScroll, {passive: true})
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onListAreaPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const session = marqueeRef.current
    if (!session || session.pointerId !== e.pointerId) return

    session.currentX = e.clientX
    session.currentY = e.clientY
    syncMarqueeFromSession()
  }

  function onListAreaPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const session = marqueeRef.current
    if (!session || session.pointerId !== e.pointerId) return

    session.currentX = e.clientX
    session.currentY = e.clientY

    if (session.active) {
      const origin = marqueeViewportOrigin(session)
      const box = normalizeMarqueeBox(
        origin.x,
        origin.y,
        session.currentX,
        session.currentY,
      )
      const next = resolveMarqueeSelection(hitSkillIdsInBox(box), session)
      if (next.size > 0 || session.wasSelectMode) {
        setOpenMenuId(null)
        setSelectMode(true)
        setSelectedIds(next)
      }
    }
    endMarqueeSession(e.currentTarget, e.pointerId)
  }

  function onListAreaPointerCancel(e: ReactPointerEvent<HTMLDivElement>) {
    const session = marqueeRef.current
    if (!session || session.pointerId !== e.pointerId) return
    endMarqueeSession(e.currentTarget, e.pointerId)
  }

  useEffect(() => {
    return () => {
      const scrollEl = getMarqueeScrollEl()
      scrollEl?.removeEventListener('scroll', onMarqueeScroll)
      document.body.classList.remove('is-marquee-selecting')
    }
  }, [onMarqueeScroll])

  function onCardPointerDown(e: ReactPointerEvent, skillId: string) {
    if (e.button !== 0) return
    if (selectMode) return
    clearLongPressTimer()
    longPressOrigin.current = {x: e.clientX, y: e.clientY}
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null
      longPressOrigin.current = null
      enterSelectMode(skillId)
    }, LONG_PRESS_MS)
  }

  function onCardPointerMove(e: ReactPointerEvent) {
    if (!longPressOrigin.current || longPressTimer.current == null) return
    const dx = e.clientX - longPressOrigin.current.x
    const dy = e.clientY - longPressOrigin.current.y
    if (dx * dx + dy * dy > MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX) {
      clearLongPressTimer()
    }
  }

  function onCardPointerEnd() {
    clearLongPressTimer()
  }

  function onCardClick(skillId: string) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (selectMode) {
      toggleSelect(skillId)
      return
    }
    onOpenEditor(skillId)
  }

  function openConfirm(
    next:
      | {kind: 'delete-skill'; skill: SkillEntry}
      | {kind: 'delete-skills-batch'}
      | {kind: 'delete-group'; groupId: string}
      | {kind: 'restore-overwrite'; item: TrashItem}
      | {kind: 'purge-trash'; item: TrashItem},
  ) {
    setConfirmError('')
    setConfirmDialog(next)
  }

  function openDeleteDialog(skill: SkillEntry) {
    setOpenMenuId(null)
    openConfirm({kind: 'delete-skill', skill})
  }

  function openBatchDeleteDialog() {
    if (selectedIds.size === 0) return
    openConfirm({kind: 'delete-skills-batch'})
  }

  function closeConfirmDialog() {
    if (confirmBusy) return
    setConfirmDialog(null)
    setConfirmError('')
  }

  async function submitConfirmDialog() {
    if (!confirmDialog) return
    setConfirmBusy(true)
    setConfirmError('')
    setError('')
    try {
      switch (confirmDialog.kind) {
        case 'delete-skill':
          await DeleteSkill(confirmDialog.skill.id)
          setConfirmDialog(null)
          await load()
          break
        case 'delete-skills-batch': {
          let deleted = 0
          const failures: string[] = []
          for (const id of selectedIds) {
            try {
              await DeleteSkill(id)
              deleted++
            } catch (e) {
              failures.push(`${id}: ${e instanceof Error ? e.message : String(e)}`)
            }
          }
          setConfirmDialog(null)
          await load()
          if (failures.length > 0) {
            setError(
              `批量删除：成功 ${deleted} · 失败 ${failures.length}。${failures
                .slice(0, 3)
                .join('；')}`,
            )
          }
          exitSelectMode()
          break
        }
        case 'delete-group':
          await DeleteGroup(confirmDialog.groupId)
          setConfirmDialog(null)
          await load()
          break
        case 'restore-overwrite':
          await RestoreTrash(confirmDialog.item.trashPath, true)
          setConfirmDialog(null)
          await loadTrash()
          await load()
          break
        case 'purge-trash':
          await PurgeTrash(confirmDialog.item.trashPath)
          setConfirmDialog(null)
          await loadTrash()
          break
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (
        confirmDialog.kind === 'restore-overwrite' ||
        confirmDialog.kind === 'purge-trash'
      ) {
        setConfirmDialog(null)
        setTrashError(msg)
      } else {
        setConfirmError(msg)
      }
    } finally {
      setConfirmBusy(false)
    }
  }

  function openRenameDialog(skill: SkillEntry) {
    setOpenMenuId(null)
    setRenameSkill(skill)
    setRenameId(skill.id)
    setRenameError('')
    setRenameOpen(true)
  }

  async function copySkillId(skillId: string) {
    try {
      const ok = await ClipboardSetText(skillId)
      if (!ok) {
        setError('复制技能 ID 失败')
        return
      }
      if (copyFeedbackTimer.current != null) {
        window.clearTimeout(copyFeedbackTimer.current)
      }
      setCopiedSkillId(skillId)
      copyFeedbackTimer.current = window.setTimeout(() => {
        setCopiedSkillId(null)
        copyFeedbackTimer.current = null
      }, 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    return () => {
      if (copyFeedbackTimer.current != null) {
        window.clearTimeout(copyFeedbackTimer.current)
      }
    }
  }, [])

  function closeRenameDialog() {
    if (renaming) return
    setRenameOpen(false)
    setRenameSkill(null)
    setRenameError('')
  }

  async function handleRename() {
    if (!renameSkill) return
    const nextId = renameId.trim()
    if (!nextId) {
      setRenameError('请填写新的技能 ID')
      return
    }
    if (nextId === renameSkill.id) {
      setRenameError('新 ID 与当前相同')
      return
    }
    setRenaming(true)
    setRenameError('')
    try {
      await RenameSkill(renameSkill.id, nextId)
      setRenameOpen(false)
      setRenameSkill(null)
      await load()
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : String(e))
    } finally {
      setRenaming(false)
    }
  }

  function openEnableDialog(skill: SkillEntry) {
    setOpenMenuId(null)
    setEnableSkill(skill)
    setEnableSelected(new Set(linkableTools.filter((t) => hasSymlink(skill, t.id)).map((t) => t.id)))
    setEnableError('')
    setEnableOpen(true)
  }

  async function openSkillInFolder(skill: SkillEntry) {
    setOpenMenuId(null)
    const path = skill.hubPath?.trim()
    if (!path) {
      setError('无法打开：该技能在源仓中无路径')
      return
    }
    try {
      await OpenFolder(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function closeEnableDialog() {
    if (enabling) return
    setEnableOpen(false)
    setEnableSkill(null)
    setEnableError('')
  }

  function toggleEnableTool(toolId: string) {
    setEnableSelected((prev) => {
      const next = new Set(prev)
      if (next.has(toolId)) next.delete(toolId)
      else next.add(toolId)
      return next
    })
  }

  async function handleEnableConfirm() {
    if (!enableSkill) return
    setEnabling(true)
    setEnableError('')
    try {
      for (const tool of linkableTools) {
        const want = enableSelected.has(tool.id)
        const current = hasSymlink(enableSkill, tool.id)
        if (want !== current) {
          await SetSkillLink(enableSkill.id, tool.id, want)
        }
      }
      setEnableOpen(false)
      setEnableSkill(null)
      await load()
    } catch (e) {
      setEnableError(e instanceof Error ? e.message : String(e))
    } finally {
      setEnabling(false)
    }
  }

  async function openBulkDialog() {
    setBulkError('')
    setBulkResult(null)
    setBulkConfirm(null)
    setBulkStep(1)
    setBulkAction('enable')
    setBulkSelected(new Set())
    setBulkSnapshots({})
    setBulkOpen(true)
    const snaps: Record<string, LinkSnapshot | null> = {}
    for (const t of linkableTools) {
      try {
        const s = await GetLinkSnapshot(t.id)
        snaps[t.id] = (s as LinkSnapshot | null | undefined) ?? null
      } catch {
        snaps[t.id] = null
      }
    }
    setBulkSnapshots(snaps)
    const anySnap = Object.values(snaps).some((s) => (s?.count ?? 0) > 0)
    setBulkMode(anySnap ? 'restore' : 'all')
  }

  function closeBulkDialog() {
    if (bulkBusy) return
    setBulkOpen(false)
    setBulkError('')
    setBulkResult(null)
    setBulkConfirm(null)
    setBulkStep(1)
  }

  function goBulkStep2() {
    if (bulkSelected.size === 0) return
    const ids = [...bulkSelected]
    const action = inferBulkAction(skills, ids)
    setBulkAction(action)
    const anySnap = ids.some((id) => (bulkSnapshots[id]?.count ?? 0) > 0)
    setBulkMode(anySnap ? 'restore' : 'all')
    setBulkError('')
    setBulkResult(null)
    setBulkConfirm(null)
    setBulkStep(2)
  }

  function goBulkStep1() {
    if (bulkBusy) return
    setBulkError('')
    setBulkResult(null)
    setBulkConfirm(null)
    setBulkStep(1)
  }

  async function handleBulkExecute() {
    setBulkError('')
    setBulkResult(null)
    if (bulkAction === 'disable') {
      requestBulkDisable()
      return
    }
    const ids = [...bulkSelected]
    if (ids.length === 0) return
    if (bulkMode === 'all') {
      const hubCount = skills.filter((s) => s.hubPath).length
      const estimated = hubCount * ids.length
      if (estimated > 20) {
        setBulkConfirm(
          `预计最多新建约 ${estimated} 个符号链接（源仓技能 × 已选工作目录）。`,
        )
        return
      }
    }
    await runBulkEnable()
  }

  function toggleBulkTool(toolId: string) {
    setBulkSelected((prev) => {
      const next = new Set(prev)
      if (next.has(toolId)) next.delete(toolId)
      else next.add(toolId)
      return next
    })
    setBulkConfirm(null)
  }

  function toggleBulkSelectAll() {
    if (bulkSelected.size === linkableTools.length) {
      setBulkSelected(new Set())
    } else {
      setBulkSelected(new Set(linkableTools.map((t) => t.id)))
    }
    setBulkConfirm(null)
  }

  async function refreshBulkSnapshots(toolIds: string[]) {
    const snaps: Record<string, LinkSnapshot | null> = {...bulkSnapshots}
    for (const id of toolIds) {
      try {
        const s = await GetLinkSnapshot(id)
        snaps[id] = (s as LinkSnapshot | null | undefined) ?? null
      } catch {
        snaps[id] = null
      }
    }
    setBulkSnapshots(snaps)
  }

  function requestBulkDisable() {
    const ids = [...bulkSelected]
    if (ids.length === 0) return
    let approxLinks = 0
    for (const id of ids) {
      approxLinks += toolLinkStats(skills, id).links
    }
    setBulkConfirm(
      `将对 ${ids.length} 个工作目录移除合计约 ${approxLinks} 个符号链接；源仓与真实副本不受影响。`,
    )
  }

  async function runBulkDisable() {
    const ids = [...bulkSelected]
    if (ids.length === 0) return
    setBulkConfirm(null)
    setBulkBusy(true)
    setBulkError('')
    setBulkResult(null)
    try {
      const result = (await DisableAllSkillLinks(ids)) as BulkLinkResult
      setBulkResult(result)
      await refreshBulkSnapshots(ids)
      await load()
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : String(e))
    } finally {
      setBulkBusy(false)
    }
  }

  async function runBulkEnable() {
    const ids = [...bulkSelected]
    if (ids.length === 0) return
    setBulkConfirm(null)
    setBulkBusy(true)
    setBulkError('')
    setBulkResult(null)
    try {
      const result = (await EnableSkillLinks(ids, bulkMode)) as BulkLinkResult
      setBulkResult(result)
      await load()
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : String(e))
    } finally {
      setBulkBusy(false)
    }
  }

  async function confirmBulkAction() {
    if (bulkAction === 'disable') {
      await runBulkDisable()
    } else {
      await runBulkEnable()
    }
  }

  function openCreateDialog() {
    setCreateId('')
    setCreateName('')
    setCreateGroup(DEFAULT_GROUP_ID)
    setCreateLanguage('zh-CN')
    setCreateGroupMenuOpen(false)
    setCreateLanguageMenuOpen(false)
    setDialogError('')
    setCreateOpen(true)
  }

  function closeCreateDialog() {
    if (creating) return
    setCreateOpen(false)
    setCreateGroupMenuOpen(false)
    setCreateLanguageMenuOpen(false)
    setDialogError('')
  }

  useEffect(() => {
    if (!createGroupMenuOpen && !createLanguageMenuOpen) return
    const onDoc = (ev: MouseEvent) => {
      if (
        createGroupMenuRef.current &&
        !createGroupMenuRef.current.contains(ev.target as Node)
      ) {
        setCreateGroupMenuOpen(false)
      }
      if (
        createLanguageMenuRef.current &&
        !createLanguageMenuRef.current.contains(ev.target as Node)
      ) {
        setCreateLanguageMenuOpen(false)
      }
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setCreateGroupMenuOpen(false)
        setCreateLanguageMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [createGroupMenuOpen, createLanguageMenuOpen])

  function openAssignGroup(skill: SkillEntry) {
    setOpenMenuId(null)
    setAssignBatch(false)
    setAssignSkill(skill)
    setAssignSelected(skill.group || DEFAULT_GROUP_ID)
    setAssignError('')
    setAssignOpen(true)
  }

  function openBatchAssignGroup() {
    if (selectedIds.size === 0) return
    const skillById = new Map(skills.map((s) => [s.id, s]))
    const groupsOfSelected = new Set<string>()
    for (const id of selectedIds) {
      const skill = skillById.get(id)
      if (skill) groupsOfSelected.add(skill.group || DEFAULT_GROUP_ID)
    }
    const preselected =
      groupsOfSelected.size === 1
        ? [...groupsOfSelected][0]
        : DEFAULT_GROUP_ID
    setAssignBatch(true)
    setAssignSkill(null)
    setAssignSelected(preselected)
    setAssignError('')
    setAssignOpen(true)
  }

  function closeAssignGroupDialog() {
    if (assigning) return
    setAssignOpen(false)
    setAssignSkill(null)
    setAssignBatch(false)
    setAssignError('')
  }

  async function handleAssignGroup() {
    if (assignBatch) {
      if (selectedIds.size === 0) return
      setAssigning(true)
      setAssignError('')
      let moved = 0
      let skipped = 0
      const failures: string[] = []
      const skillById = new Map(skills.map((s) => [s.id, s]))
      try {
        for (const id of selectedIds) {
          const skill = skillById.get(id)
          if (!skill) {
            failures.push(`${id}: 未找到`)
            continue
          }
          const current = skill.group || DEFAULT_GROUP_ID
          if (current === assignSelected) {
            skipped++
            continue
          }
          try {
            await SetSkillGroup(id, assignSelected)
            moved++
          } catch (e) {
            failures.push(`${id}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        setAssignOpen(false)
        setAssignBatch(false)
        await load()
        if (failures.length > 0) {
          setError(
            `批量分组：成功 ${moved} · 跳过 ${skipped} · 失败 ${failures.length}。${failures.slice(0, 3).join('；')}`,
          )
        }
        exitSelectMode()
      } catch (e) {
        setAssignError(e instanceof Error ? e.message : String(e))
      } finally {
        setAssigning(false)
      }
      return
    }

    if (!assignSkill) return
    setAssigning(true)
    setAssignError('')
    try {
      await SetSkillGroup(assignSkill.id, assignSelected)
      setAssignOpen(false)
      setAssignSkill(null)
      await load()
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : String(e))
    } finally {
      setAssigning(false)
    }
  }

  function openCreateGroupDialog() {
    setCreateGroupName('')
    setCreateGroupError('')
    setCreateGroupOpen(true)
  }

  function closeCreateGroupDialog() {
    if (creatingGroup) return
    setCreateGroupOpen(false)
    setCreateGroupError('')
  }

  async function handleCreateGroup() {
    const name = createGroupName.trim()
    if (!name) {
      setCreateGroupError('请填写分组名称')
      return
    }
    setCreatingGroup(true)
    setCreateGroupError('')
    try {
      await CreateGroup(name)
      setCreateGroupOpen(false)
      await load()
    } catch (e) {
      setCreateGroupError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreatingGroup(false)
    }
  }

  function openRenameGroup(groupId: string) {
    setRenameGroupId(groupId)
    setRenameGroupName(groupId)
    setRenameGroupError('')
    setRenameGroupOpen(true)
  }

  function closeRenameGroupDialog() {
    if (renamingGroup) return
    setRenameGroupOpen(false)
    setRenameGroupId('')
    setRenameGroupError('')
  }

  async function handleRenameGroup() {
    const next = renameGroupName.trim()
    if (!next) {
      setRenameGroupError('请填写新的分组名称')
      return
    }
    if (next === renameGroupId) {
      setRenameGroupError('新名称与当前相同')
      return
    }
    setRenamingGroup(true)
    setRenameGroupError('')
    try {
      await RenameGroup(renameGroupId, next)
      setRenameGroupOpen(false)
      setRenameGroupId('')
      await load()
    } catch (e) {
      setRenameGroupError(e instanceof Error ? e.message : String(e))
    } finally {
      setRenamingGroup(false)
    }
  }

  function openDeleteGroupDialog(groupId: string) {
    openConfirm({kind: 'delete-group', groupId})
  }

  async function handleCreate() {
    const id = createId.trim()
    const name = createName.trim()
    if (!id) {
      setDialogError('请填写技能 ID')
      return
    }
    if (!name) {
      setDialogError('请填写技能名称')
      return
    }
    setCreating(true)
    setDialogError('')
    try {
      await CreateSkill(id, name, createGroup, createLanguage)
      setCreateOpen(false)
      setCreateGroupMenuOpen(false)
      setCreateLanguageMenuOpen(false)
      setDialogError('')
      await load()
      onOpenEditor(id)
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  async function loadTrash() {
    setTrashLoading(true)
    setTrashError('')
    try {
      const items = await ListTrash()
      setTrashItems((items ?? []) as TrashItem[])
    } catch (e) {
      setTrashError(e instanceof Error ? e.message : String(e))
    } finally {
      setTrashLoading(false)
    }
  }

  async function openTrash() {
    setTrashOpen(true)
    await loadTrash()
  }

  function remainingInfo(expiresAt: string): {label: string; urgent: boolean} {
    const ms = new Date(expiresAt).getTime() - Date.now()
    if (Number.isNaN(ms)) return {label: '—', urgent: false}
    const d = Math.ceil(ms / (24 * 3600 * 1000))
    if (d <= 0) return {label: '即将清理', urgent: true}
    return {label: `剩余 ${d} 天`, urgent: false}
  }

  async function handleRestore(item: TrashItem) {
    try {
      await RestoreTrash(item.trashPath, false)
      await loadTrash()
      await load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('目标已存在')) {
        openConfirm({kind: 'restore-overwrite', item})
        return
      }
      setTrashError(msg)
    }
  }

  function openPurgeDialog(item: TrashItem) {
    openConfirm({kind: 'purge-trash', item})
  }

  function openBatchEnableDialog() {
    if (selectedIds.size === 0) return
    // 默认勾选：已选技能上已有链接的工具并集（与单卡启用的「当前状态」对齐）
    const initial = new Set<string>()
    const skillById = new Map(skills.map((s) => [s.id, s]))
    for (const id of selectedIds) {
      const skill = skillById.get(id)
      if (!skill) continue
      for (const tool of linkableTools) {
        if (hasSymlink(skill, tool.id)) initial.add(tool.id)
      }
    }
    setBatchEnableTools(initial)
    setBatchEnableError('')
    setBatchEnableOpen(true)
  }

  function closeBatchEnableDialog() {
    if (batchEnabling) return
    setBatchEnableOpen(false)
    setBatchEnableError('')
  }

  function toggleBatchEnableTool(toolId: string) {
    setBatchEnableTools((prev) => {
      const next = new Set(prev)
      if (next.has(toolId)) next.delete(toolId)
      else next.add(toolId)
      return next
    })
  }

  async function handleBatchEnableConfirm() {
    if (selectedIds.size === 0) return
    setBatchEnabling(true)
    setBatchEnableError('')
    let linked = 0
    let unlinked = 0
    let skipped = 0
    const failures: string[] = []
    const skillById = new Map(skills.map((s) => [s.id, s]))
    const needAdminMsg =
      '需要管理员权限才能创建符号链接，请在设置中点击「以管理员身份重启」'
    try {
      // 预判是否有实际改动；未提权时整次拦截并留在对话框内提示（勿静默关闭）
      let pendingChanges = 0
      for (const skillId of selectedIds) {
        const skill = skillById.get(skillId)
        if (!skill) continue
        for (const tool of linkableTools) {
          if (batchEnableTools.has(tool.id) !== hasSymlink(skill, tool.id)) {
            pendingChanges++
          }
        }
      }
      if (pendingChanges > 0) {
        const elevated = await IsElevated()
        if (!elevated) {
          setBatchEnableError(needAdminMsg)
          return
        }
      }

      for (const skillId of selectedIds) {
        const skill = skillById.get(skillId)
        if (!skill) {
          failures.push(`${skillId}: 未找到`)
          continue
        }
        for (const tool of linkableTools) {
          const want = batchEnableTools.has(tool.id)
          const current = hasSymlink(skill, tool.id)
          if (want === current) {
            skipped++
            continue
          }
          try {
            await SetSkillLink(skillId, tool.id, want)
            if (want) linked++
            else unlinked++
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            failures.push(`${skillId}/${tool.id}: ${msg}`)
            // 提权类错误对后续调用必然复现，提前中止并留在对话框提示
            if (msg.includes('管理员权限')) {
              setBatchEnableError(msg.includes('以管理员') ? msg : needAdminMsg)
              return
            }
          }
        }
      }

      // 全部失败：保持对话框打开并展示错误，不退出多选（与单卡启用一致）
      if (failures.length > 0 && linked === 0 && unlinked === 0) {
        setBatchEnableError(
          `全部失败（${failures.length}）。${failures.slice(0, 3).join('；')}`,
        )
        return
      }

      setBatchEnableOpen(false)
      await load()
      if (failures.length > 0) {
        setError(
          `批量启用：新建 ${linked} · 移除 ${unlinked} · 跳过 ${skipped} · 失败 ${failures.length}。${failures.slice(0, 3).join('；')}`,
        )
      }
      exitSelectMode()
    } catch (e) {
      setBatchEnableError(e instanceof Error ? e.message : String(e))
    } finally {
      setBatchEnabling(false)
    }
  }

  function renderSkillCard(skill: SkillEntry) {
    const toolsLinked = linkedToolIds(skill)
    const menuOpen = openMenuId === skill.id
    const isSelected = marqueeHitIds
      ? marqueeHitIds.has(skill.id)
      : selectedIds.has(skill.id)
    const cardClass = [
      'skill-card',
      selectMode ? 'is-selecting' : '',
      isSelected ? 'is-selected' : '',
    ]
      .filter(Boolean)
      .join(' ')
    return (
      <article
        key={skill.id}
        data-skill-id={skill.id}
        className={cardClass}
        onClick={() => onCardClick(skill.id)}
        onPointerDown={(e) => onCardPointerDown(e, skill.id)}
        onPointerMove={onCardPointerMove}
        onPointerUp={onCardPointerEnd}
        onPointerCancel={onCardPointerEnd}
        onPointerLeave={onCardPointerEnd}
        onContextMenu={(e) => {
          if (selectMode || suppressClickRef.current) e.preventDefault()
        }}
        role="button"
        tabIndex={0}
        aria-pressed={selectMode ? isSelected : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onCardClick(skill.id)
          }
        }}
      >
        {selectMode ? (
          <span
            className={isSelected ? 'card-check is-checked' : 'card-check'}
            aria-hidden="true"
          />
        ) : (
          <div
            className="card-menu-wrap"
            ref={menuOpen ? menuRef : undefined}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="card-menu-btn"
              aria-label="更多操作"
              onClick={() => setOpenMenuId(menuOpen ? null : skill.id)}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="card-menu">
                <button type="button" onClick={() => void openSkillInFolder(skill)}>
                  打开
                </button>
                <button type="button" onClick={() => openEnableDialog(skill)}>
                  启用
                </button>
                <button type="button" onClick={() => openRenameDialog(skill)}>
                  重命名
                </button>
                <button type="button" onClick={() => openAssignGroup(skill)}>
                  分组
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => openDeleteDialog(skill)}
                >
                  删除
                </button>
              </div>
            ) : null}
          </div>
        )}

        <div className="skill-name-row">
          <h3>{skill.name || skill.id}</h3>
          <button
            type="button"
            className={
              copiedSkillId === skill.id
                ? 'skill-id-copy-btn is-copied'
                : 'skill-id-copy-btn'
            }
            aria-label={copiedSkillId === skill.id ? '已复制' : '复制技能 ID'}
            title={copiedSkillId === skill.id ? '已复制' : '复制技能 ID'}
            onClick={(e) => {
              e.stopPropagation()
              void copySkillId(skill.id)
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {copiedSkillId === skill.id ? (
              <IconCheck size={14} />
            ) : (
              <IconCopy size={14} />
            )}
          </button>
        </div>
        <p className="skill-id">{skill.id}</p>
        <p className="desc">{skill.description || '暂无描述'}</p>
        <div className="skill-lang-row">
          <span className="skill-lang-left">
            <span className="skill-lang-label">{languageLabel(skill.defaultLanguage)}</span>
            {(skill.translationCount ?? 0) > 0 ? (
              <span
                className="skill-translation-count"
                title={`${skill.translationCount} 个翻译版本`}
                aria-label={`${skill.translationCount} 个翻译版本`}
              >
                {skill.translationCount}
              </span>
            ) : null}
          </span>
          <span className="skill-usage muted">
            {formatUsageLabel(
              usageById[skill.id]?.count ?? 0,
              usageById[skill.id]?.lastUsedAt,
            )}
          </span>
        </div>
        <div className="skill-meta">
          <span className={`badge status-${skill.status}`}>
            {STATUS_LABELS[skill.status] ?? skill.status}
          </span>
          {toolsLinked.map((tid) => (
            <span key={tid} className="badge tool">
              {tid}
            </span>
          ))}
        </div>
      </article>
    )
  }

  const showEmpty =
    layout === 'grouped' ? sections.length === 0 : filtered.length === 0

  return (
    <div className={selectMode ? 'skills-page is-selecting' : 'skills-page'}>
      <AppToast toast={toast} onDismiss={dismissToast} />
      <div className="page-sticky-header">
        <div className="page-toolbar">
          <button
            type="button"
            className={
              layout === 'grouped'
                ? 'btn btn-icon layout-toggle is-active'
                : 'btn btn-icon layout-toggle'
            }
            onClick={() => void toggleLayout()}
            title={layout === 'flat' ? '切换到分组布局' : '切换到平铺布局'}
            aria-label={layout === 'flat' ? '切换到分组布局' : '切换到平铺布局'}
            aria-pressed={layout === 'grouped'}
          >
            {layout === 'flat' ? (
              <IconLayoutList size={22} />
            ) : (
              <IconLayoutGrid size={22} />
            )}
          </button>
          <input
            type="search"
            placeholder="搜索名称或 ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索技能"
          />
          <div className="toolbar-actions">
            <button
              type="button"
              className="btn btn-primary btn-icon"
              onClick={openCreateDialog}
              title="新建"
              aria-label="新建"
            >
              <IconPlus size={22} />
            </button>
            {layout === 'grouped' ? (
              <button
                type="button"
                className="btn btn-icon"
                onClick={openCreateGroupDialog}
                title="新增分组"
                aria-label="新增分组"
              >
                <IconFolderPlus size={22} />
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-icon"
              onClick={onOrganize}
              title="一键整理"
              aria-label="一键整理"
            >
              <IconFolderSync size={22} />
            </button>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => void load()}
              title="刷新"
              aria-label="刷新"
            >
              <IconRefresh size={22} />
            </button>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => void openTrash()}
              title="回收站"
              aria-label="回收站"
            >
              <IconTrash size={22} />
            </button>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => void openBulkDialog()}
              title="按工具批量启用 / 禁用"
              aria-label="按工具批量启用 / 禁用"
            >
              <IconBulkToolLinks size={22} />
            </button>
          </div>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {importing ? <div className="info-banner">正在导入 skill…</div> : null}
      {fileDragOver && !importing ? (
        <div className="info-banner skills-drop-hint" role="status">
          松开鼠标以导入 skill 文件夹、zip 或 .skill 包
        </div>
      ) : null}

      {importReport ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog dialog-wide"
            role="dialog"
            aria-labelledby="import-report-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="import-report-title">导入报告</h2>
            <p className="muted">
              成功 {importReport.imported} · 跳过 {importReport.skipped} · 失败{' '}
              {importReport.failed}
            </p>
            {importReport.items.length > 0 ? (
              <ul className="import-report-list">
                {importReport.items.map((item, i) => (
                  <li key={`${item.id}-${i}`} className={`import-report-item status-${item.status}`}>
                    <strong>{item.id || '—'}</strong>
                    <span className="import-report-status">
                      {item.status === 'imported'
                        ? '已导入'
                        : item.status === 'skipped'
                          ? '已跳过'
                          : '失败'}
                    </span>
                    {item.reason ? <span className="muted">{item.reason}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setImportReport(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {batchEnableOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog"
            role="dialog"
            aria-labelledby="batch-enable-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="batch-enable-title">批量启用</h2>
            <p className="muted">
              将对 {selectedIds.size}{' '}
              个技能同步工具链接：勾选的建立链接，未勾选的将移除对应链接。
            </p>
            {linkableTools.length === 0 ? (
              <p className="muted">暂无可用工具，请先在设置中配置并启用工具路径。</p>
            ) : (
              <div className="enable-tool-list">
                {linkableTools.map((tool) => (
                  <label key={tool.id} className="check-field enable-tool-item">
                    <input
                      type="checkbox"
                      checked={batchEnableTools.has(tool.id)}
                      disabled={batchEnabling}
                      onChange={() => toggleBatchEnableTool(tool.id)}
                    />
                    <span>{tool.id}</span>
                  </label>
                ))}
              </div>
            )}
            {batchEnableError ? <div className="dialog-error">{batchEnableError}</div> : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={batchEnabling}
                onClick={closeBatchEnableDialog}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={batchEnabling || linkableTools.length === 0}
                onClick={() => void handleBatchEnableConfirm()}
              >
                {batchEnabling ? '保存中…' : '确认'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {enableOpen && enableSkill ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog"
            role="dialog"
            aria-labelledby="enable-tools-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="enable-tools-title">启用工具链接</h2>
            <p className="muted">技能：{enableSkill.name || enableSkill.id}</p>
            {linkableTools.length === 0 ? (
              <p className="muted">暂无可用工具，请先在设置中配置并启用工具路径。</p>
            ) : (
              <div className="enable-tool-list">
                {linkableTools.map((tool) => (
                  <label key={tool.id} className="check-field enable-tool-item">
                    <input
                      type="checkbox"
                      checked={enableSelected.has(tool.id)}
                      disabled={enabling}
                      onChange={() => toggleEnableTool(tool.id)}
                    />
                    <span>{tool.id}</span>
                  </label>
                ))}
              </div>
            )}
            {enableError ? <div className="dialog-error">{enableError}</div> : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={enabling}
                onClick={closeEnableDialog}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={enabling || linkableTools.length === 0}
                onClick={() => void handleEnableConfirm()}
              >
                {enabling ? '保存中…' : '确认'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bulkOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog dialog-wide dialog-bulk"
            role="dialog"
            aria-labelledby="bulk-tool-links-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="bulk-dialog-head">
              <div>
                <h2 id="bulk-tool-links-title">按工具批量启用 / 禁用</h2>
                <p className="bulk-dialog-desc">
                  {bulkStep === 1
                    ? '选择要操作的工作目录（工具 skills 根）'
                    : '确认已选目录后，选择启用或禁用'}
                </p>
              </div>
              <div className="bulk-steps" aria-label="步骤">
                <span className={bulkStep === 1 ? 'bulk-step active' : 'bulk-step done'}>
                  1 选目录
                </span>
                <span className="bulk-step-sep" aria-hidden="true" />
                <span className={bulkStep === 2 ? 'bulk-step active' : 'bulk-step'}>
                  2 选操作
                </span>
              </div>
            </header>

            <div className="bulk-dialog-body">
            {bulkStep === 1 ? (
              <>
                {linkableTools.length === 0 ? (
                  <p className="muted">暂无可用工作目录，请先在设置中配置并启用工具路径。</p>
                ) : (
                  <>
                    <div className="bulk-tool-toolbar">
                      <span className="muted">
                        已选 {bulkSelected.size} / {linkableTools.length}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={bulkBusy}
                        onClick={toggleBulkSelectAll}
                      >
                        {bulkSelected.size === linkableTools.length ? '取消全选' : '全选'}
                      </button>
                    </div>
                    <div className="bulk-tool-list">
                      {linkableTools.map((tool) => {
                        const selected = bulkSelected.has(tool.id)
                        const stats = toolLinkStats(skills, tool.id)
                        return (
                          <label
                            key={tool.id}
                            className={
                              selected
                                ? 'bulk-tool-item is-selected'
                                : 'bulk-tool-item'
                            }
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={bulkBusy}
                              onChange={() => toggleBulkTool(tool.id)}
                            />
                            <span className="bulk-tool-label">
                              <span className="bulk-tool-name">{tool.id}</span>
                              <span className="bulk-tool-meta">
                                链接 {stats.links} · 副本 {stats.copies} ·{' '}
                                {snapshotLabel(bulkSnapshots[tool.id])}
                              </span>
                              <span className="bulk-tool-path" title={tool.path}>
                                {tool.path}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <section className="bulk-section">
                  <div className="bulk-section-head">
                    <p className="bulk-section-title">已选工作目录</p>
                    <span className="bulk-count-badge">{bulkSelected.size}</span>
                  </div>
                  <ul className="bulk-selected-summary">
                    {[...bulkSelected].map((id) => {
                      const tool = linkableTools.find((t) => t.id === id)
                      const stats = toolLinkStats(skills, id)
                      return (
                        <li key={id} className="bulk-selected-item">
                          <div className="bulk-selected-top">
                            <strong>{id}</strong>
                            <span className="bulk-tool-meta">
                              链接 {stats.links} · 副本 {stats.copies} ·{' '}
                              {snapshotLabel(bulkSnapshots[id])}
                            </span>
                          </div>
                          {tool?.path ? (
                            <div className="bulk-tool-path" title={tool.path}>
                              {tool.path}
                            </div>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </section>

                <section className="bulk-section">
                  <p className="bulk-section-title">操作</p>
                  <div className="bulk-choice-grid">
                    <label
                      className={
                        bulkAction === 'enable'
                          ? 'bulk-choice is-active'
                          : 'bulk-choice'
                      }
                    >
                      <input
                        type="radio"
                        name="bulk-action"
                        checked={bulkAction === 'enable'}
                        disabled={bulkBusy}
                        onChange={() => {
                          setBulkAction('enable')
                          setBulkConfirm(null)
                        }}
                      />
                      <span className="bulk-choice-title">启用</span>
                      <span className="bulk-choice-desc">建立或恢复符号链接</span>
                    </label>
                    <label
                      className={
                        bulkAction === 'disable'
                          ? 'bulk-choice is-active'
                          : 'bulk-choice'
                      }
                    >
                      <input
                        type="radio"
                        name="bulk-action"
                        checked={bulkAction === 'disable'}
                        disabled={bulkBusy}
                        onChange={() => {
                          setBulkAction('disable')
                          setBulkConfirm(null)
                        }}
                      />
                      <span className="bulk-choice-title">禁用全部</span>
                      <span className="bulk-choice-desc">移除符号链接与断链</span>
                    </label>
                  </div>
                </section>

                <section
                  className={
                    bulkAction === 'enable'
                      ? 'bulk-section bulk-mode-panel'
                      : 'bulk-section bulk-mode-panel is-disabled'
                  }
                >
                  <p className="bulk-section-title">启用方式</p>
                  <div className="bulk-choice-grid bulk-choice-grid-sm">
                    <label
                      className={
                        bulkMode === 'all' ? 'bulk-choice is-active' : 'bulk-choice'
                      }
                    >
                      <input
                        type="radio"
                        name="bulk-mode"
                        checked={bulkMode === 'all'}
                        disabled={bulkBusy || bulkAction !== 'enable'}
                        onChange={() => {
                          setBulkMode('all')
                          setBulkConfirm(null)
                        }}
                      />
                      <span className="bulk-choice-title">全部开启</span>
                      <span className="bulk-choice-desc">源仓可链技能全部建链</span>
                    </label>
                    <label
                      className={
                        bulkMode === 'restore'
                          ? 'bulk-choice is-active'
                          : 'bulk-choice'
                      }
                    >
                      <input
                        type="radio"
                        name="bulk-mode"
                        checked={bulkMode === 'restore'}
                        disabled={
                          bulkBusy || bulkAction !== 'enable' || !canRestoreBulk
                        }
                        onChange={() => {
                          setBulkMode('restore')
                          setBulkConfirm(null)
                        }}
                      />
                      <span className="bulk-choice-title">恢复上次</span>
                      <span className="bulk-choice-desc">
                        {canRestoreBulk ? '按禁用前快照重建' : '当前无可用快照'}
                      </span>
                    </label>
                  </div>
                  <p className="muted bulk-hint">
                    {bulkAction === 'disable'
                      ? '将移除已选工作目录下的符号链接与断链；源仓与真实副本不受影响。'
                      : canRestoreBulk
                        ? '可选择全部开启，或按上次禁用前的快照恢复。'
                        : '已选目录均无禁用快照，「恢复上次」不可用。'}
                  </p>
                </section>
              </>
            )}
            </div>

            {bulkStep === 2 && (bulkConfirm || bulkError || bulkResult) ? (
              <div className="bulk-feedback">
                {bulkConfirm ? (
                  <div className="bulk-confirm" role="status">
                    <p>{bulkConfirm}</p>
                    <div className="bulk-confirm-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={bulkBusy}
                        onClick={() => setBulkConfirm(null)}
                      >
                        返回修改
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={bulkBusy}
                        onClick={() => void confirmBulkAction()}
                      >
                        {bulkBusy ? '执行中…' : '确认继续'}
                      </button>
                    </div>
                  </div>
                ) : null}

                {bulkError ? <div className="dialog-error">{bulkError}</div> : null}

                {bulkResult ? (
                  <div
                    className={
                      (bulkResult.totals?.failed ?? 0) > 0
                        ? 'bulk-result bulk-result-warn'
                        : 'bulk-result bulk-result-ok'
                    }
                    role="status"
                  >
                    <p className="bulk-result-title">
                      {formatBulkResultSummary(bulkResult, bulkAction)}
                    </p>
                    {(bulkResult.tools ?? [])
                      .flatMap((t) => t.failed ?? [])
                      .slice(0, 5)
                      .map((f, i) => (
                        <p key={i} className="muted">
                          {f.skillId ? `${f.skillId}: ` : ''}
                          {f.reason}
                        </p>
                      ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="dialog-actions">
              {bulkStep === 1 ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={bulkBusy}
                    onClick={closeBulkDialog}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={bulkBusy || bulkSelected.size === 0}
                    onClick={goBulkStep2}
                  >
                    下一步
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={bulkBusy}
                    onClick={goBulkStep1}
                  >
                    上一步
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={bulkBusy}
                    onClick={closeBulkDialog}
                  >
                    关闭
                  </button>
                  {!bulkConfirm ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={bulkBusy || bulkSelected.size === 0}
                      onClick={() => void handleBulkExecute()}
                    >
                      {bulkBusy
                        ? '执行中…'
                        : bulkAction === 'disable'
                          ? '执行禁用'
                          : '执行启用'}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {renameOpen && renameSkill ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog"
            role="dialog"
            aria-labelledby="rename-skill-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="rename-skill-title">重命名技能</h2>
            <p className="muted">当前 ID：{renameSkill.id}</p>
            <label className="field">
              <span>新 ID</span>
              <input
                value={renameId}
                onChange={(e) => {
                  setRenameId(e.target.value)
                  setRenameError('')
                }}
                placeholder="例如 my-skill"
                autoFocus
                disabled={renaming}
              />
            </label>
            {renameError ? <div className="dialog-error">{renameError}</div> : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={renaming}
                onClick={closeRenameDialog}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={renaming}
                onClick={() => void handleRename()}
              >
                {renaming ? '重命名中…' : '确认'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog"
            role="dialog"
            aria-labelledby="create-skill-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="create-skill-title">新建技能</h2>
            <label className="field">
              <span>ID</span>
              <input
                value={createId}
                onChange={(e) => {
                  setCreateId(e.target.value)
                  setDialogError('')
                }}
                placeholder="例如 my-skill"
                autoFocus
                disabled={creating}
              />
            </label>
            <label className="field">
              <span>名称</span>
              <input
                value={createName}
                onChange={(e) => {
                  setCreateName(e.target.value)
                  setDialogError('')
                }}
                placeholder="显示名称"
                disabled={creating}
              />
            </label>
            <div className="field">
              <span>分组</span>
              <div className="field-select" ref={createGroupMenuRef}>
                <button
                  type="button"
                  className="field-select-trigger"
                  disabled={creating}
                  aria-haspopup="listbox"
                  aria-expanded={createGroupMenuOpen}
                  onClick={() => setCreateGroupMenuOpen((v) => !v)}
                >
                  {groupDisplayName(createGroup)}
                </button>
                {createGroupMenuOpen ? (
                  <ul className="field-select-menu" role="listbox">
                    {sortedGroups.map((g) => (
                      <li key={g.id} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={createGroup === g.id}
                          className={createGroup === g.id ? 'is-active' : undefined}
                          onClick={() => {
                            setCreateGroup(g.id)
                            setCreateGroupMenuOpen(false)
                          }}
                        >
                          {groupDisplayName(g.id)}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            <div className="field">
              <span>原版语言</span>
              <div className="field-select" ref={createLanguageMenuRef}>
                <button
                  type="button"
                  className="field-select-trigger"
                  disabled={creating}
                  aria-haspopup="listbox"
                  aria-expanded={createLanguageMenuOpen}
                  onClick={() => setCreateLanguageMenuOpen((v) => !v)}
                >
                  {languageLabel(createLanguage)}
                </button>
                {createLanguageMenuOpen ? (
                  <ul className="field-select-menu" role="listbox">
                    {SKILL_LANGUAGES.map((lang) => (
                      <li key={lang.value} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={createLanguage === lang.value}
                          className={createLanguage === lang.value ? 'is-active' : undefined}
                          onClick={() => {
                            setCreateLanguage(lang.value)
                            setCreateLanguageMenuOpen(false)
                          }}
                        >
                          {lang.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            <div className="field">
              <span>原版语言</span>
              <div className="field-select" ref={createLanguageMenuRef}>
                <button
                  type="button"
                  className="field-select-trigger"
                  disabled={creating}
                  aria-haspopup="listbox"
                  aria-expanded={createLanguageMenuOpen}
                  onClick={() => setCreateLanguageMenuOpen((v) => !v)}
                >
                  {languageLabel(createLanguage)}
                </button>
                {createLanguageMenuOpen ? (
                  <ul className="field-select-menu" role="listbox">
                    {SKILL_LANGUAGES.map((lang) => (
                      <li key={lang.value} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={createLanguage === lang.value}
                          className={createLanguage === lang.value ? 'is-active' : undefined}
                          onClick={() => {
                            setCreateLanguage(lang.value)
                            setCreateLanguageMenuOpen(false)
                          }}
                        >
                          {lang.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            {dialogError ? <div className="dialog-error">{dialogError}</div> : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={creating}
                onClick={closeCreateDialog}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={creating}
                onClick={() => void handleCreate()}
              >
                {creating ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {assignOpen && (assignSkill || assignBatch) ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog"
            role="dialog"
            aria-labelledby="assign-group-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="assign-group-title">{assignBatch ? '批量分组' : '设置分组'}</h2>
            <p className="muted">
              {assignBatch
                ? `将已选 ${selectedIds.size} 个技能移动到目标分组；已在该分组中的会跳过。`
                : `技能：${assignSkill?.name || assignSkill?.id}`}
            </p>
            <div className="enable-tool-list">
              {sortedGroups.map((g) => (
                <label key={g.id} className="check-field enable-tool-item">
                  <input
                    type="radio"
                    name="assign-group"
                    checked={assignSelected === g.id}
                    disabled={assigning}
                    onChange={() => setAssignSelected(g.id)}
                  />
                  <span>{groupDisplayName(g.id)}</span>
                </label>
              ))}
            </div>
            {assignError ? <div className="dialog-error">{assignError}</div> : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={assigning}
                onClick={closeAssignGroupDialog}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={assigning || groups.length === 0}
                onClick={() => void handleAssignGroup()}
              >
                {assigning ? '保存中…' : '确认'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createGroupOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog"
            role="dialog"
            aria-labelledby="create-group-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="create-group-title">新增分组</h2>
            <label className="field">
              <span>名称</span>
              <input
                value={createGroupName}
                onChange={(e) => {
                  setCreateGroupName(e.target.value)
                  setCreateGroupError('')
                }}
                placeholder="例如 工作流"
                autoFocus
                disabled={creatingGroup}
              />
            </label>
            {createGroupError ? <div className="dialog-error">{createGroupError}</div> : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={creatingGroup}
                onClick={closeCreateGroupDialog}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={creatingGroup}
                onClick={() => void handleCreateGroup()}
              >
                {creatingGroup ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {renameGroupOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog"
            role="dialog"
            aria-labelledby="rename-group-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="rename-group-title">编辑分组</h2>
            <p className="muted">当前名称：{renameGroupId}</p>
            <label className="field">
              <span>新名称</span>
              <input
                value={renameGroupName}
                onChange={(e) => {
                  setRenameGroupName(e.target.value)
                  setRenameGroupError('')
                }}
                placeholder="分组名称"
                autoFocus
                disabled={renamingGroup}
              />
            </label>
            {renameGroupError ? <div className="dialog-error">{renameGroupError}</div> : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={renamingGroup}
                onClick={closeRenameGroupDialog}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={renamingGroup}
                onClick={() => void handleRenameGroup()}
              >
                {renamingGroup ? '保存中…' : '确认'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {trashOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog dialog-wide dialog-trash"
            role="dialog"
            aria-labelledby="trash-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="trash-dialog-head">
              <div>
                <h2 id="trash-title">回收站</h2>
                <p className="muted trash-lead">
                  过期条目会自动清理；恢复后需重新启用工具链接。
                </p>
              </div>
              <button type="button" className="btn" onClick={() => setTrashOpen(false)}>
                关闭
              </button>
            </header>
            <div className="trash-dialog-body">
              {trashError ? <div className="error-banner">{trashError}</div> : null}
              {trashLoading ? <p className="muted">加载中…</p> : null}
              {!trashLoading && trashItems.length === 0 ? (
                <div className="trash-empty">
                  <p className="trash-empty-title">回收站为空</p>
                  <p className="trash-empty-desc">删除的技能会出现在这里</p>
                </div>
              ) : (
                <ul className="trash-list">
                  {trashItems.map((item) => {
                    const expire = remainingInfo(item.expiresAt)
                    return (
                      <li key={item.trashPath} className="trash-row">
                        <div className="trash-row-info">
                          <div className="trash-row-name">{item.name || item.id}</div>
                          <div className="muted trash-row-id">{item.id}</div>
                          <div className="trash-row-meta">
                            <span className="muted">
                              删除于 {new Date(item.deletedAt).toLocaleString()}
                            </span>
                            <span
                              className={
                                expire.urgent
                                  ? 'badge trash-expire is-urgent'
                                  : 'badge trash-expire'
                              }
                            >
                              {expire.label}
                            </span>
                          </div>
                        </div>
                        <div className="trash-actions">
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={confirmBusy}
                            onClick={() => void handleRestore(item)}
                          >
                            恢复
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            disabled={confirmBusy}
                            onClick={() => openPurgeDialog(item)}
                          >
                            彻底删除
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div
        ref={listAreaRef}
        className={
          fileDragOver ? 'skills-list-area is-file-drag-over' : 'skills-list-area'
        }
        onPointerDown={onListAreaPointerDown}
        onPointerMove={onListAreaPointerMove}
        onPointerUp={onListAreaPointerUp}
        onPointerCancel={onListAreaPointerCancel}
      >
        <div className="skills-drop-overlay" aria-hidden={!fileDragOver}>
          <span>松开以导入 skill 文件夹、zip 或 .skill 包</span>
        </div>
        {loading ? (
          <p className="muted">加载中…</p>
        ) : showEmpty ? (
          <div className="empty-state">
            暂无技能{query ? '（无匹配结果）' : '，可拖入文件夹、zip 或 .skill 包导入'}
          </div>
        ) : layout === 'grouped' ? (
          <div className="skill-groups">
            {sections.map((sec) => {
              const collapsed = isGroupCollapsed(sec.id, sec.skills.length)
              return (
              <section className="skill-group-section" key={sec.id}>
                <div
                  className="skill-group-header"
                  onMouseEnter={() => {
                    if (!selectMode) showGroupActions(sec.id)
                  }}
                  onMouseLeave={() => {
                    if (!selectMode) scheduleHideGroupActions()
                  }}
                >
                  <div className="skill-group-title-row">
                    <h2>{groupDisplayName(sec.id)}</h2>
                    <button
                      type="button"
                      className="skill-group-collapse"
                      aria-label={collapsed ? '展开分组' : '折叠分组'}
                      aria-expanded={!collapsed}
                      onClick={() => toggleGroupCollapse(sec.id)}
                    >
                      <IconChevron
                        size={20}
                        className={`skill-group-collapse-chevron${collapsed ? '' : ' open'}`}
                      />
                    </button>
                  </div>
                  <div className="skill-group-header-trailing">
                    {selectMode ? (
                      <button
                        type="button"
                        className="skill-group-select-all"
                        disabled={
                          batchEnabling ||
                          assigning ||
                          confirmBusy ||
                          sec.skills.length === 0
                        }
                        onClick={() => toggleSelectAllInGroup(sec.skills)}
                      >
                        {sec.skills.length > 0 &&
                        sec.skills.every((s) => selectedIds.has(s.id))
                          ? '取消全选'
                          : '全选'}
                      </button>
                    ) : sec.id !== DEFAULT_GROUP_ID &&
                      actionsVisibleGroupId === sec.id ? (
                      <div className="skill-group-actions">
                        <button
                          type="button"
                          aria-label="编辑分组"
                          onClick={() => openRenameGroup(sec.id)}
                        >
                          <IconPencil size={16} />
                        </button>
                        <button
                          type="button"
                          className="danger"
                          aria-label="删除分组"
                          onClick={() => openDeleteGroupDialog(sec.id)}
                        >
                          <IconTrash size={16} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                {collapsed ? null : (
                  <div className="skill-grid">{sec.skills.map(renderSkillCard)}</div>
                )}
              </section>
              )
            })}
          </div>
        ) : (
          <div className="skill-grid">{filtered.map(renderSkillCard)}</div>
        )}
      </div>
      {marqueeBox ? (
        <div
          className="marquee-rect"
          style={{
            left: marqueeBox.left,
            top: marqueeBox.top,
            width: marqueeBox.width,
            height: marqueeBox.height,
          }}
          aria-hidden="true"
        />
      ) : null}
      {selectMode ? (
        <div className="select-action-bar" role="toolbar" aria-label="多选操作">
          <span className="select-count">已选 {selectedIds.size}</span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={batchEnabling || assigning || confirmBusy || filtered.length === 0}
            onClick={toggleSelectAllFiltered}
          >
            {filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id))
              ? '取消全选'
              : '全选'}
          </button>
          <div className="select-action-spacer" />
          <button
            type="button"
            className="btn btn-primary"
            disabled={batchEnabling || assigning || confirmBusy || selectedIds.size === 0}
            onClick={openBatchEnableDialog}
          >
            启用
          </button>
          <button
            type="button"
            className="btn"
            disabled={batchEnabling || assigning || confirmBusy || selectedIds.size === 0}
            onClick={openBatchAssignGroup}
          >
            分组
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={batchEnabling || assigning || confirmBusy || selectedIds.size === 0}
            onClick={openBatchDeleteDialog}
          >
            {confirmBusy && confirmDialog?.kind === 'delete-skills-batch'
              ? '删除中…'
              : '删除'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={batchEnabling || assigning || confirmBusy}
            onClick={exitSelectMode}
          >
            取消
          </button>
        </div>
      ) : null}

      {confirmDialog ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog dialog-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skills-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="skills-confirm-title">
              {confirmDialog.kind === 'delete-skill'
                ? '删除技能？'
                : confirmDialog.kind === 'delete-skills-batch'
                  ? '批量删除技能？'
                  : confirmDialog.kind === 'delete-group'
                    ? '删除分组？'
                    : confirmDialog.kind === 'restore-overwrite'
                      ? '覆盖已有技能？'
                      : '彻底删除？'}
            </h2>
            <p className="muted dialog-confirm-body">
              {confirmDialog.kind === 'delete-skill' ? (
                <>
                  确认删除技能{' '}
                  <strong>{confirmDialog.skill.name || confirmDialog.skill.id}</strong>
                  {' '}？将移入回收站
                  {(confirmDialog.skill.translationCount ?? 0) > 0
                    ? `；同时会永久删除其 ${confirmDialog.skill.translationCount} 个翻译版本`
                    : ''}
                  。
                </>
              ) : confirmDialog.kind === 'delete-skills-batch' ? (
                `确认将 ${selectedIds.size} 个技能移入回收站？若含翻译版本，将一并永久删除。`
              ) : confirmDialog.kind === 'delete-group' ? (
                <>
                  删除分组后，其中的技能将回到{' '}
                  <strong>默认</strong>
                  {' '}。确认删除？
                </>
              ) : confirmDialog.kind === 'restore-overwrite' ? (
                <>
                  <strong>{confirmDialog.item.name || confirmDialog.item.id}</strong>
                  {' '}在源仓已存在。覆盖后，现有副本将再移入回收站。
                </>
              ) : (
                <>
                  彻底删除{' '}
                  <strong>{confirmDialog.item.name || confirmDialog.item.id}</strong>
                  {' '}？此操作不可恢复。
                </>
              )}
            </p>
            {confirmError ? <div className="dialog-error">{confirmError}</div> : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={confirmBusy}
                onClick={closeConfirmDialog}
              >
                取消
              </button>
              <button
                type="button"
                className={
                  confirmDialog.kind === 'restore-overwrite'
                    ? 'btn btn-primary'
                    : 'btn btn-danger'
                }
                disabled={confirmBusy}
                onClick={() => void submitConfirmDialog()}
              >
                {confirmBusy
                  ? confirmDialog.kind === 'restore-overwrite'
                    ? '覆盖中…'
                    : '处理中…'
                  : confirmDialog.kind === 'restore-overwrite'
                    ? '覆盖'
                    : confirmDialog.kind === 'purge-trash'
                      ? '彻底删除'
                      : '删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
