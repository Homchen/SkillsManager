import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {
  ApplyConflictRound,
  CanExecuteOrganize,
  CancelDeepScan,
  ConfirmAddWorkdirs,
  DeepScanSkills,
  ExecuteOrganize,
  PreviewOrganize,
  PreviewRestoreOrphanLinks,
  ReadConflictFileTexts,
  ResetConflict,
  RestoreOrphanLinks,
  SetConflictFileChoice,
  SkipConflict,
  UpdateOrganizePlan,
} from '../../wailsjs/go/main/App'
import {EventsOff, EventsOn} from '../../wailsjs/runtime/runtime'
import type {domain} from '../../wailsjs/go/models'
import ThreeWayMerge from '../components/ThreeWayMerge'
import {AppToast, useAppToast} from '../components/AppToast'
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconCheckCircle2,
  IconChevron,
  IconCopy,
  IconFile,
  IconFileBinary,
  IconFileCode,
  IconFileText,
  IconFolderPlus,
  IconFolderSync,
  IconGitMerge,
  IconLink,
  IconMaximize,
  IconMinimize,
  IconRefresh,
  IconRotateCcw,
  IconSearch,
  IconShieldAlert,
  IconShieldCheck,
  IconSparkles,
  IconWrench,
  IconX,
} from '../components/icons'
import {normalizeText} from '../lib/lineDiff'
import {getToolBadge} from '../lib/toolBadge'
import {
  calculateOrganizeMetrics,
  conflictFileProgress,
  conflictFilesReady,
  conflictRoundNeedsApply,
  conflictSkillNeedsAttention,
  detectToolFromPath,
  errMsg,
  filterActionSectionsByQuery,
  groupActionsByType,
  isOrganizeActionSelectable,
  normalizeCanExecute,
  organizeSelectionState,
  splitDisplayPath,
  splitScanWalkPath,
} from '../lib/organizeHelpers'

type OrganizePlan = domain.OrganizePlan
type OrganizeAction = domain.OrganizeAction
type ConflictSkill = domain.ConflictSkill
type OrganizeReport = domain.OrganizeReport
type SuggestedWorkdir = domain.SuggestedWorkdir
type RestoreOrphanItem = domain.RestoreOrphanItem

const ACTION_CONFIG: Record<
  string,
  {label: string; description: string; icon: typeof IconFolderPlus; toneClass: string}
> = {
  move_to_hub: {
    label: '待迁入源仓',
    description: '将工具目录中的散落副本迁移至中心源仓',
    icon: IconFolderPlus,
    toneClass: 'type-move_to_hub',
  },
  replace_with_symlink: {
    label: '待替换软链',
    description: '在原工具目录建立指向源仓的符号链接',
    icon: IconLink,
    toneClass: 'type-replace_with_symlink',
  },
  merge_conflict: {
    label: '内容冲突',
    description: '多来源同名技能内容不一致，需人工决议',
    icon: IconAlertTriangle,
    toneClass: 'type-merge_conflict',
  },
  fix_link: {
    label: '修复断链',
    description: '纠偏损坏失效的外部符号链接',
    icon: IconWrench,
    toneClass: 'type-fix_link',
  },
  skip: {
    label: '保持跳过',
    description: '已正确链接或处于规范状态，无需操作',
    icon: IconCheck,
    toneClass: 'type-skip',
  },
  skipped_by_user: {
    label: '用户跳过',
    description: '由您手动跳过的动作',
    icon: IconCheck,
    toneClass: 'type-skipped_by_user',
  },
}

function OrganizeSkillIdentity({
  skillId,
  trailing,
}: {
  skillId: string
  trailing?: ReactNode
}) {
  const {leaf, parent} = splitDisplayPath(skillId)
  return (
    <div className="organize-skill-cell">
      <div className="organize-skill-id-block">
        <span className="organize-skill-id-chip" title={skillId}>
          {leaf || skillId}
        </span>
        {parent ? (
          <span className="organize-skill-id-parent" title={skillId}>
            {parent}
          </span>
        ) : null}
      </div>
      {trailing ? <div className="organize-skill-trailing">{trailing}</div> : null}
    </div>
  )
}

function OrganizeSourcePath({path}: {path: string}) {
  const {leaf, parent, separator} = splitDisplayPath(path)
  return (
    <span className="organize-source-path" title={path} dir="ltr">
      {parent ? (
        <>
          <span className="organize-path-parent">{parent}</span>
          <span className="organize-path-sep">{separator}</span>
        </>
      ) : null}
      <span className="organize-path-leaf">{leaf || path}</span>
    </span>
  )
}

const FILE_STATUS_LABELS: Record<string, string> = {
  only_a: '仅侧 A（保留）',
  only_b: '仅侧 B（保留）',
  both_same: '两侧相同',
  both_diff: '两侧存在差异',
}

function bothDiffResolved(file: {status: string; choice?: string; mergedContent?: string}): boolean {
  if (file.status !== 'both_diff') return false
  if (file.choice === 'keep_a' || file.choice === 'keep_b') return true
  return file.choice === 'manual' && Boolean(file.mergedContent)
}

function conflictFileItemClass(
  active: boolean,
  file: {status: string; choice?: string; mergedContent?: string},
): string {
  const parts = ['conflict-file-item']
  if (active) parts.push('active')
  if (file.status === 'both_diff') {
    parts.push(bothDiffResolved(file) ? 'is-diff-done' : 'is-diff')
  }
  return parts.join(' ')
}

function conflictFileChoiceSuffix(file: {status: string; choice?: string}): string {
  if (file.status !== 'both_diff' || !file.choice) return ''
  if (file.choice === 'keep_a') return ' · A'
  if (file.choice === 'keep_b') return ' · B'
  if (file.choice === 'manual') return ' · 手动'
  return ''
}

type Props = {
  onBack: () => void
}

export default function OrganizePage({onBack}: Props) {
  const [plan, setPlan] = useState<OrganizePlan | null>(null)
  const [activeConflictId, setActiveConflictId] = useState<string | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [canExecute, setCanExecute] = useState(false)
  const [report, setReport] = useState<OrganizeReport | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [workdirDialogOpen, setWorkdirDialogOpen] = useState(false)
  const [workdirSuggestions, setWorkdirSuggestions] = useState<SuggestedWorkdir[]>([])
  const [workdirSelected, setWorkdirSelected] = useState<Set<string>>(() => new Set())
  const [confirmingWorkdirs, setConfirmingWorkdirs] = useState(false)
  const [workdirDialogError, setWorkdirDialogError] = useState('')
  const [restoreScanning, setRestoreScanning] = useState(false)
  const [restoreProgress, setRestoreProgress] = useState('')
  const [restoreOrphansAvailable, setRestoreOrphansAvailable] = useState(false)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [restoreItems, setRestoreItems] = useState<RestoreOrphanItem[]>([])
  const [restoreSelected, setRestoreSelected] = useState<Set<string>>(() => new Set())
  const [restoringOrphans, setRestoringOrphans] = useState(false)
  const [restoreDialogError, setRestoreDialogError] = useState('')
  const [error, setError] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [executing, setExecuting] = useState(false)
  const planRef = useRef<OrganizePlan | null>(null)
  const previewSeqRef = useRef(0)
  const choiceSeqRef = useRef(0)
  const planCommitRef = useRef(Promise.resolve())
  const [deepScanning, setDeepScanning] = useState(false)
  const [deepProgress, setDeepProgress] = useState('')
  const [deepVisitCount, setDeepVisitCount] = useState(0)
  const [applyingRound, setApplyingRound] = useState(false)
  const [isConflictMaximized, setIsConflictMaximized] = useState(false)
  const [actionQuery, setActionQuery] = useState('')
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const {toast, showToast, dismissToast} = useAppToast()

  /** 默认折叠「跳过」分组 */
  const [collapsedActionTypes, setCollapsedActionTypes] = useState<Set<string>>(
    () => new Set(['skip']),
  )

  function resetActionGroupCollapse() {
    setCollapsedActionTypes(new Set(['skip']))
  }

  function toggleActionGroupCollapse(type: string) {
    setCollapsedActionTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const copyText = useCallback((text: string, id: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      setTimeout(() => {
        setCopiedId((curr) => (curr === id ? null : curr))
      }, 1500)
    })
  }, [])

  const refreshGate = useCallback(async () => {
    if (!plan) {
      setCanExecute(false)
      return
    }
    try {
      const result = await CanExecuteOrganize()
      const {ok} = normalizeCanExecute(result)
      setCanExecute(ok)
    } catch {
      setCanExecute(false)
    }
  }, [plan])

  useEffect(() => {
    void refreshGate()
  }, [refreshGate, plan])

  const refreshRestoreOrphanDetection = useCallback(
    async (opts?: {silent?: boolean}) => {
      const silent = opts?.silent ?? false
      if (!silent) {
        setRestoreScanning(true)
        setRestoreProgress('')
        setRestoreDialogError('')
      }
      try {
        const items = (await PreviewRestoreOrphanLinks()) ?? []
        setRestoreItems(items)
        setRestoreSelected(new Set(items.map((i) => i.linkPath)))
        setRestoreOrphansAvailable(items.length > 0)
        return items
      } catch (e) {
        if (!silent) setError(errMsg(e))
        return []
      } finally {
        if (!silent) {
          setRestoreScanning(false)
          setRestoreProgress('')
        }
      }
    },
    [],
  )

  useEffect(() => {
    void refreshRestoreOrphanDetection({silent: true})
  }, [refreshRestoreOrphanDetection])

  useEffect(() => {
    const offDeep = EventsOn('deepscan:progress', (...data: unknown[]) => {
      const path = typeof data[0] === 'string' ? data[0] : String(data[0] ?? '')
      setDeepProgress(path)
      setDeepVisitCount((n) => n + 1)
    })
    const offRestore = EventsOn('restoreorphan:progress', (...data: unknown[]) => {
      const path = typeof data[0] === 'string' ? data[0] : String(data[0] ?? '')
      setRestoreProgress(path)
    })
    return () => {
      EventsOff('deepscan:progress')
      EventsOff('restoreorphan:progress')
      if (typeof offDeep === 'function') offDeep()
      if (typeof offRestore === 'function') offRestore()
    }
  }, [])

  function closeWorkdirDialog() {
    setWorkdirDialogOpen(false)
    setWorkdirDialogError('')
    setConfirmingWorkdirs(false)
  }

  function applyPlan(next: OrganizePlan, opts?: {clearReport?: boolean; openConflict?: boolean}) {
    planRef.current = next
    setPlan(next)
    if (opts?.clearReport) {
      setReport(null)
      setReportOpen(false)
      closeWorkdirDialog()
      setWorkdirSuggestions([])
      setWorkdirSelected(new Set())
    }
    const conflicts = next.conflicts ?? []
    if (activeConflictId && !conflicts.some((c) => c.skillId === activeConflictId)) {
      setActiveConflictId(conflicts[0]?.skillId ?? null)
    } else if (!activeConflictId && conflicts.length > 0) {
      setActiveConflictId(conflicts[0].skillId)
    }
    if (conflicts.length === 0) {
      setConflictOpen(false)
      setDialogError('')
    } else if (opts?.openConflict) {
      setConflictOpen(true)
      setDialogError('')
    }
  }

  async function loadPreview(opts?: {toastMessage?: string; keepDeepScan?: boolean}) {
    const seq = ++previewSeqRef.current
    setLoadingPreview(true)
    setError('')
    setReport(null)
    setReportOpen(false)
    setDialogError('')
    setActionQuery('')
    try {
      const next = await PreviewOrganize(Boolean(opts?.keepDeepScan))
      if (seq !== previewSeqRef.current) return
      const conflicts = next.conflicts ?? []
      resetActionGroupCollapse()
      applyPlan(next, {clearReport: true, openConflict: conflicts.length > 0})
      setActiveConflictId(conflicts[0]?.skillId ?? null)
      showToast({
        message:
          opts?.toastMessage ??
          `扫描完成：${(next.actions ?? []).length} 项动作${conflicts.length ? `，${conflicts.length} 项冲突` : ''}`,
        tone: 'success',
      })
    } catch (e) {
      if (seq !== previewSeqRef.current) return
      setError(errMsg(e))
    } finally {
      if (seq === previewSeqRef.current) setLoadingPreview(false)
    }
  }

  async function handlePreview() {
    await loadPreview()
  }

  async function commitPlanActions(actions: OrganizeAction[]) {
    const run = async () => {
      const base = planRef.current
      if (!base) return
      const next = {
        actions,
        conflicts: (base.conflicts ?? []).map((c) => ({
          ...c,
          files: (c.files ?? []).map((f) => ({...f})),
        })),
      } as OrganizePlan
      setError('')
      await UpdateOrganizePlan(next)
      applyPlan(next)
    }
    const p = planCommitRef.current.then(run, run)
    planCommitRef.current = p.then(
      () => undefined,
      () => undefined,
    )
    try {
      await p
    } catch (e) {
      setError(errMsg(e))
    }
  }

  async function handleToggleSelected(index: number, selected: boolean) {
    const base = planRef.current
    if (!base) return
    const actions = (base.actions ?? []).map((a, i) =>
      i === index ? {...a, selected} : {...a},
    ) as OrganizeAction[]
    await commitPlanActions(actions)
  }

  async function handleToggleIndices(indices: number[], selected: boolean) {
    const base = planRef.current
    if (!base || indices.length === 0) return
    const set = new Set(indices)
    const actions = (base.actions ?? []).map((a, i) =>
      set.has(i) && isOrganizeActionSelectable(a.type) ? {...a, selected} : {...a},
    ) as OrganizeAction[]
    await commitPlanActions(actions)
  }

  async function handleSkip(skillId: string) {
    setDialogError('')
    try {
      const next = await SkipConflict(skillId)
      applyPlan(next)
      showToast({message: `已跳过冲突技能：${skillId}`, tone: 'info'})
    } catch (e) {
      setDialogError(errMsg(e))
    }
  }

  async function handleReset(skillId: string) {
    setDialogError('')
    try {
      const next = await ResetConflict(skillId)
      applyPlan(next)
      showToast({message: `已重置选择：${skillId}`, tone: 'info'})
    } catch (e) {
      setDialogError(errMsg(e))
    }
  }

  async function handleChoice(
    skillId: string,
    rel: string,
    choice: string,
    merged: string,
  ) {
    const seq = ++choiceSeqRef.current
    setDialogError('')
    try {
      const next = await SetConflictFileChoice(skillId, rel, choice, merged)
      if (seq !== choiceSeqRef.current) return
      applyPlan(next)
    } catch (e) {
      if (seq !== choiceSeqRef.current) return
      setDialogError(errMsg(e))
    }
  }

  async function handleExecute() {
    setExecuting(true)
    setError('')
    try {
      await planCommitRef.current
      const gate = normalizeCanExecute(await CanExecuteOrganize())
      if (!gate.ok) {
        setCanExecute(false)
        showToast({message: gate.reason || '当前无法执行整理', tone: 'warn'})
        return
      }
      const result = await ExecuteOrganize()
      setReport(result)
      setReportOpen(true)
      showToast({message: '整理执行完成！已归集至源仓并建立软链', tone: 'success'})
      const sugs = result.suggestedWorkdirs ?? []
      if (sugs.length > 0) {
        setWorkdirSuggestions(sugs)
        setWorkdirSelected(new Set(sugs.map((s) => s.path)))
        setWorkdirDialogError('')
        setWorkdirDialogOpen(true)
      } else {
        closeWorkdirDialog()
        setWorkdirSuggestions([])
        setWorkdirSelected(new Set())
      }
      try {
        const next = await PreviewOrganize(true)
        resetActionGroupCollapse()
        applyPlan(next)
        const conflicts = next.conflicts ?? []
        if (!conflicts.some((c) => c.skillId === activeConflictId)) {
          setActiveConflictId(conflicts[0]?.skillId ?? null)
        }
      } catch {
        // 报告已展示；刷新预览失败不覆盖执行结果
      }
      void refreshRestoreOrphanDetection({silent: true})
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setExecuting(false)
    }
  }

  function toggleWorkdirSelected(path: string) {
    setWorkdirSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function selectAllWorkdirs() {
    setWorkdirSelected(new Set(workdirSuggestions.map((s) => s.path)))
  }

  function deselectAllWorkdirs() {
    setWorkdirSelected(new Set())
  }

  async function handleConfirmAddWorkdirs() {
    const paths = [...workdirSelected]
    setConfirmingWorkdirs(true)
    setWorkdirDialogError('')
    try {
      const result = await ConfirmAddWorkdirs(paths)
      const added = result.added?.length ?? 0
      const linked = result.linked?.length ?? 0
      showToast({
        message: `工作目录已添加：${added} 个目录，建立 ${linked} 个链接`,
        tone: 'success',
      })
      closeWorkdirDialog()
    } catch (e) {
      setWorkdirDialogError(errMsg(e))
    } finally {
      setConfirmingWorkdirs(false)
    }
  }

  async function handleDeepScan() {
    setDeepScanning(true)
    setDeepProgress('')
    setDeepVisitCount(0)
    setError('')
    try {
      const extras = await DeepScanSkills()
      const extraCount = extras?.length ?? 0
      setDeepScanning(false)
      setDeepProgress('')
      setDeepVisitCount(0)
      await loadPreview({
        keepDeepScan: true,
        toastMessage:
          extraCount > 0
            ? `全盘扫描完成，发现 ${extraCount} 个额外技能，已进入预览`
            : '全盘扫描完成，已进入预览',
      })
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setDeepScanning(false)
      setDeepProgress('')
      setDeepVisitCount(0)
    }
  }

  function handleCancelDeepScan() {
    void CancelDeepScan()
    showToast({message: '已请求取消深度扫描…', tone: 'info'})
  }

  function closeRestoreDialog() {
    setRestoreDialogOpen(false)
    setRestoreDialogError('')
    setRestoringOrphans(false)
  }

  async function handleScanRestoreOrphans() {
    setError('')
    setRestoreDialogError('')
    if (restoreItems.length > 0) {
      setRestoreDialogOpen(true)
      return
    }
    const items = await refreshRestoreOrphanDetection()
    if (items.length === 0) {
      showToast({message: '未发现可恢复的误迁符号链接', tone: 'info'})
      setRestoreDialogOpen(false)
    } else {
      setRestoreDialogOpen(true)
    }
  }

  function toggleRestoreSelected(path: string) {
    setRestoreSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function handleConfirmRestoreOrphans() {
    const paths = [...restoreSelected]
    setRestoringOrphans(true)
    setRestoreDialogError('')
    try {
      const result = await RestoreOrphanLinks(paths)
      const ok = result.succeeded?.length ?? 0
      const failed = result.failed ?? []
      showToast({
        message: `误迁恢复完成：成功 ${ok} · 失败 ${failed.length}`,
        tone: failed.length > 0 ? 'warn' : 'success',
      })
      if (failed.length > 0) {
        setRestoreDialogError(
          failed.map((f) => `${f.skillId}: ${f.message}`).join('\n'),
        )
      }
      const succeeded = result.succeeded ?? []
      const still = restoreItems.filter((i) => {
        if (!restoreSelected.has(i.linkPath)) return false
        return !succeeded.some((s) => (s.message ?? '').includes(i.linkPath))
      })
      const untouched = restoreItems.filter((i) => !restoreSelected.has(i.linkPath))
      const next = [...untouched, ...still]
      setRestoreItems(next)
      setRestoreSelected(new Set(still.map((i) => i.linkPath)))
      if (next.length === 0 && failed.length === 0) {
        closeRestoreDialog()
        setRestoreOrphansAvailable(false)
      }
    } catch (e) {
      setRestoreDialogError(errMsg(e))
    } finally {
      setRestoringOrphans(false)
    }
  }

  async function handleApplyRound(skillId: string) {
    setApplyingRound(true)
    setDialogError('')
    try {
      const next = await ApplyConflictRound(skillId)
      applyPlan(next)
      showToast({message: `已应用本轮合并：${skillId}`, tone: 'success'})
    } catch (e) {
      setDialogError(errMsg(e))
    } finally {
      setApplyingRound(false)
    }
  }

  function openConflictDialog(skillId?: string) {
    const list = plan?.conflicts ?? []
    if (list.length === 0) return
    if (skillId && list.some((c) => c.skillId === skillId)) {
      setActiveConflictId(skillId)
    } else if (!activeConflictId || !list.some((c) => c.skillId === activeConflictId)) {
      setActiveConflictId(list[0].skillId)
    }
    setDialogError('')
    setConflictOpen(true)
  }

  function closeConflictDialog() {
    setConflictOpen(false)
    setDialogError('')
  }

  const conflicts = plan?.conflicts ?? []
  const actions = plan?.actions ?? []
  const metrics = useMemo(
    () => calculateOrganizeMetrics(actions, conflicts),
    [actions, conflicts],
  )
  const deepWalk = useMemo(() => splitScanWalkPath(deepProgress), [deepProgress])
  const actionSections = useMemo(() => groupActionsByType(actions), [actions])

  // 按类型过滤
  const typeFilteredSections = useMemo(() => {
    if (selectedTypeFilter === 'all') return actionSections
    if (selectedTypeFilter === 'skip') {
      return actionSections.filter(
        (sec) => sec.type === 'skip' || sec.type === 'skipped_by_user',
      )
    }
    return actionSections.filter((sec) => sec.type === selectedTypeFilter)
  }, [actionSections, selectedTypeFilter])

  // 按搜索词过滤
  const filteredActionSections = useMemo(
    () => filterActionSectionsByQuery(typeFilteredSections, actionQuery),
    [typeFilteredSections, actionQuery],
  )
  const visibleIndexedActions = useMemo(
    () => filteredActionSections.flatMap((sec) => sec.items),
    [filteredActionSections],
  )
  const selectionAll = useMemo(
    () => organizeSelectionState(visibleIndexedActions.map(({action}) => action)),
    [visibleIndexedActions],
  )
  const visibleSelectableIndices = useMemo(
    () =>
      visibleIndexedActions
        .filter(({action}) => isOrganizeActionSelectable(action.type))
        .map(({index}) => index),
    [visibleIndexedActions],
  )
  const activeConflict =
    conflicts.find((c) => c.skillId === activeConflictId) ?? conflicts[0] ?? null
  const attentionConflictCount = metrics.unresolvedConflictCount
  const allConflictsDecided =
    conflicts.length > 0 && attentionConflictCount === 0

  return (
    <div className="organize-page">
      <AppToast toast={toast} onDismiss={dismissToast} />

      {/* 顶部粘性全局控制栏 */}
      <header className="organize-header">
        <div className="organize-header-left">
          <button
            type="button"
            className="organize-back-btn"
            onClick={onBack}
            data-tour="demo-back"
            title="返回技能列表"
          >
            <IconArrowLeft size={16} />
            <span>返回技能</span>
          </button>
          <div className="organize-header-divider" />
          <div className="organize-header-icon">
            <IconFolderSync size={20} />
          </div>
          <div className="organize-header-titles">
            <div className="organize-title-row">
              <h2 className="organize-title">一键整理</h2>
              {!plan ? (
                <span className="organize-status-pill is-idle">
                  <span className="organize-status-dot" />
                  未扫描
                </span>
              ) : attentionConflictCount > 0 ? (
                <span className="organize-status-pill is-attention">
                  <span className="organize-status-dot is-pulse" />
                  {attentionConflictCount} 项冲突待决议
                </span>
              ) : allConflictsDecided ? (
                <span className="organize-status-pill is-success">
                  <span className="organize-status-dot" />
                  冲突已全部决议
                </span>
              ) : canExecute ? (
                <span className="organize-status-pill is-ready">
                  <span className="organize-status-dot" />
                  {metrics.toggleableCount === 0
                    ? '就绪（全部已规范）'
                    : `就绪（已选 ${metrics.selectedCount}/${metrics.toggleableCount} 项）`}
                </span>
              ) : (
                <span className="organize-status-pill is-idle">
                  <span className="organize-status-dot" />
                  待就绪
                </span>
              )}
            </div>
            <p
              className="organize-subtitle"
              title="将各 AI 工具中的技能统一归集至中心源仓，并自动建立透明符号链接"
            >
              将各 AI 工具中的技能统一归集至中心源仓，并自动建立透明符号链接
            </p>
          </div>
        </div>

        {restoreOrphansAvailable || report || plan ? (
          <div className="organize-header-right">
            <div className="toolbar-icon-group organize-header-tools" role="group" aria-label="扫描与辅助">
              {restoreOrphansAvailable ? (
                <button
                  type="button"
                  className={`btn btn-icon${restoreScanning ? ' is-active' : ''}`}
                  disabled={restoreScanning || restoringOrphans || deepScanning}
                  onClick={() => void handleScanRestoreOrphans()}
                  aria-label={restoreScanning ? '正在扫描误迁链接' : '恢复误迁链接'}
                  title="恢复误迁链接：恢复误建的指向源仓的符号链接"
                >
                  <IconRotateCcw size={16} className={restoreScanning ? 'is-spinning' : ''} />
                </button>
              ) : null}

              {report ? (
                <button
                  type="button"
                  className="btn btn-icon"
                  onClick={() => setReportOpen(true)}
                  aria-label="执行报告"
                  title="执行报告：查看最近一次整理的执行报告"
                >
                  <IconActivity size={16} />
                </button>
              ) : null}

              {plan ? (
                <button
                  type="button"
                  className={`btn btn-icon${deepScanning ? ' is-active' : ''}`}
                  disabled={loadingPreview && !deepScanning}
                  onClick={() => (deepScanning ? handleCancelDeepScan() : void handleDeepScan())}
                  aria-label={deepScanning ? '取消深度扫描' : '深度扫描'}
                  title={
                    deepScanning
                      ? '取消深度扫描'
                      : '深度扫描：重新扫描整个用户主目录，完成后刷新预览'
                  }
                >
                  <span className={deepScanning ? 'organize-search-busy' : 'organize-search-icon'}>
                    <IconSearch size={16} />
                  </span>
                </button>
              ) : null}

              {plan ? (
                <button
                  type="button"
                  className={`btn btn-icon${loadingPreview && !deepScanning ? ' is-active' : ''}`}
                  disabled={loadingPreview || executing || deepScanning}
                  onClick={() => void handlePreview()}
                  aria-label={
                    loadingPreview && !deepScanning ? '正在扫描工作目录' : '扫描工作目录'
                  }
                  title="扫描工作目录：重新扫描设置中已配置的工作目录，并刷新预览"
                >
                  <IconRefresh
                    size={16}
                    className={loadingPreview && !deepScanning ? 'is-spinning' : ''}
                  />
                </button>
              ) : null}
            </div>

            {plan && attentionConflictCount > 0 ? (
              <button
                type="button"
                className="btn btn-attention organize-header-cta"
                onClick={() => openConflictDialog()}
                title="存在同名内容冲突，必须先决议才能执行整理"
              >
                <IconAlertTriangle size={14} />
                <span>解决冲突</span>
                <span className="organize-header-count">{attentionConflictCount}</span>
              </button>
            ) : null}

            {plan ? (
              <button
                type="button"
                className="btn btn-primary btn-execute organize-header-cta"
                data-tour="demo-execute"
                disabled={!canExecute || executing || loadingPreview}
                onClick={() => void handleExecute()}
              >
                {executing ? (
                  <>
                    <IconRefresh size={15} className="is-spinning" />
                    <span>执行中…</span>
                  </>
                ) : (
                  <>
                    <IconCheck size={15} />
                    <span>执行整理</span>
                  </>
                )}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* 3步工作流指示器 */}
      <section className="organize-pipeline" aria-label="整理执行进度">
        <div
          className={`organize-pipeline-step ${
            plan ? 'is-completed' : 'is-current'
          }`}
        >
          <div className="organize-step-badge">{plan ? '✓' : '1'}</div>
          <div className="organize-step-text">
            <span className="organize-step-title">1. 扫描与发现</span>
            <span
              className="organize-step-desc"
              title={
                !plan
                  ? deepScanning
                    ? '正在全盘扫描用户主目录…'
                    : loadingPreview
                      ? '正在扫描已配置的工作目录…'
                      : '扫描工作目录或全盘查找散落技能'
                  : `已发现 ${actions.length} 项动作，${conflicts.length} 处冲突`
              }
            >
              {!plan
                ? deepScanning
                  ? '正在全盘扫描用户主目录…'
                  : loadingPreview
                    ? '正在扫描已配置的工作目录…'
                    : '扫描工作目录或全盘查找散落技能'
                : `已发现 ${actions.length} 项动作，${conflicts.length} 处冲突`}
            </span>
          </div>
        </div>

        <div className="organize-pipeline-separator" aria-hidden="true">
          <IconChevron size={14} />
        </div>

        <div
          className={`organize-pipeline-step ${
            !plan
              ? ''
              : attentionConflictCount > 0
                ? 'is-attention'
                : 'is-completed'
          }`}
        >
          <div className="organize-step-badge">
            {!plan ? '2' : attentionConflictCount > 0 ? '!' : '✓'}
          </div>
          <div className="organize-step-text">
            <span className="organize-step-title">2. 审查与冲突决议</span>
            <span
              className="organize-step-desc"
              title={
                !plan
                  ? '核对迁入清单与三向合并'
                  : attentionConflictCount > 0
                    ? `尚有 ${attentionConflictCount} 个冲突待处理`
                    : conflicts.length > 0
                      ? '所有文件冲突已全部决议'
                      : '无内容冲突，可直接执行'
              }
            >
              {!plan
                ? '核对迁入清单与三向合并'
                : attentionConflictCount > 0
                  ? `尚有 ${attentionConflictCount} 个冲突待处理`
                  : conflicts.length > 0
                    ? '所有文件冲突已全部决议'
                    : '无内容冲突，可直接执行'}
            </span>
          </div>
        </div>

        <div className="organize-pipeline-separator" aria-hidden="true">
          <IconChevron size={14} />
        </div>

        <div
          className={`organize-pipeline-step ${
            report ? 'is-completed' : canExecute ? 'is-current' : ''
          }`}
        >
          <div className="organize-step-badge">{report ? '✓' : '3'}</div>
          <div className="organize-step-text">
            <span className="organize-step-title">3. 归集迁移与建链</span>
            <span
              className="organize-step-desc"
              title={
                report
                  ? '整理已完成，符号链接生效中'
                  : canExecute
                    ? metrics.toggleableCount === 0
                      ? '方案就绪，所有技能均已规范'
                      : '方案就绪，点击开始执行'
                    : '等待前置步骤完成'
              }
            >
              {report
                ? '整理已完成，符号链接生效中'
                : canExecute
                  ? metrics.toggleableCount === 0
                    ? '方案就绪，所有技能均已规范'
                    : '方案就绪，点击开始执行'
                  : '等待前置步骤完成'}
            </span>
          </div>
        </div>
      </section>

      {/* 错误与状态提示条 */}
      {error ? (
        <div className="error-banner">
          <span>{error}</span>
          <button type="button" className="link-btn" onClick={() => setError('')}>
            关闭
          </button>
        </div>
      ) : null}

      {deepScanning ? (
        <section className="organize-scan-panel" aria-live="polite" aria-label="深度扫描进度">
          <div className="organize-scan-panel-head">
            <div className="organize-scan-panel-mark" aria-hidden="true">
              <span className="organize-search-busy">
                <IconSearch size={18} />
              </span>
            </div>
            <div className="organize-scan-panel-titles">
              <p className="organize-scan-panel-kicker">全盘查找散落技能</p>
              <h3 className="organize-scan-panel-title">深度扫描进行中</h3>
            </div>
            <div className="organize-scan-panel-stat">
              <strong>{deepVisitCount.toLocaleString('zh-CN')}</strong>
              <span>个目录</span>
            </div>
            <button type="button" className="organize-scan-cancel" onClick={handleCancelDeepScan}>
              <IconX size={14} />
              <span>取消</span>
            </button>
          </div>
          <div className="organize-scan-beam" aria-hidden="true" />
          <p className="organize-scan-panel-path" title={deepWalk.full || undefined}>
            {deepWalk.crumbs.length > 0 ? (
              <span className="organize-scan-crumbs">
                {deepWalk.crumbs.join(' › ')}
                <span className="organize-scan-sep">›</span>
              </span>
            ) : null}
            <span className="organize-scan-leaf">{deepWalk.leaf || '正在启动…'}</span>
          </p>
        </section>
      ) : null}

      {restoreScanning && restoreProgress ? (
        <div className="organize-progress-banner">
          <div className="organize-progress-text">
            <IconRotateCcw size={16} className="is-spinning" />
            <span>扫描误迁符号链接中：</span>
            <span className="mono">{restoreProgress}</span>
          </div>
        </div>
      ) : null}

      {plan && canExecute && allConflictsDecided ? (
        <div className="info-banner">
          <span>
            冲突已全部决议完成！请点击右上角「执行整理」完成向源仓迁入并挂载符号链接。
          </span>
        </div>
      ) : null}

      {/* 核心内容区 */}
      {!plan ? (
        <section className="organize-hero">
          <div className="organize-hero-badge">
            <IconSparkles size={14} />
            <span>智能化多工具协同整理</span>
          </div>
          <h3 className="organize-hero-title">将散落的 Skills 统一归集至唯一源仓</h3>
          <p className="organize-hero-desc">
            当您同时使用 Cursor、Claude、VS Code、Windsurf 等多个开发工具时，技能文件往往分散多处且容易版本脱节。一键整理能安全将所有技能集中管理，并透明建立系统级符号链接。
          </p>

          <div className="organize-hero-pillars">
            <div className="organize-hero-pillar">
              <div className="organize-pillar-head">
                <div className="organize-pillar-icon tone-hub">
                  <IconFolderPlus size={18} />
                </div>
                <span>单一真实源仓</span>
              </div>
              <p className="organize-pillar-text">
                将各处孤立副本统一搬迁到规范源仓目录，彻底杜绝多端修改带来的不同步与副本冗余。
              </p>
            </div>

            <div className="organize-hero-pillar">
              <div className="organize-pillar-head">
                <div className="organize-pillar-icon tone-symlink">
                  <IconLink size={18} />
                </div>
                <span>无感符号链接</span>
              </div>
              <p className="organize-pillar-text">
                在原工具侧原地创建符号链接，所有 AI 编程助手开箱即用无缝读取，零破坏零配置。
              </p>
            </div>

            <div className="organize-hero-pillar">
              <div className="organize-pillar-head">
                <div className="organize-pillar-icon tone-merge">
                  <IconAlertTriangle size={18} />
                </div>
                <span>行级三向合并</span>
              </div>
              <p className="organize-pillar-text">
                检测到同名技能差异时提供清晰的三向差异合并工具，保证您的每一处改动都不会被静默覆盖。
              </p>
            </div>
          </div>

          <div className="organize-hero-actions">
            <div className="organize-hero-actions-row">
              <button
                type="button"
                className="btn btn-primary btn-hero-primary"
                data-tour="demo-preview"
                disabled={loadingPreview || deepScanning}
                onClick={() => void handlePreview()}
                title="扫描设置中已配置的工具工作目录，完成后进入预览"
              >
                <IconFolderSync size={16} className={loadingPreview && !deepScanning ? 'is-spinning' : ''} />
                <span>{loadingPreview && !deepScanning ? '正在扫描…' : '扫描工作目录'}</span>
              </button>
              <button
                type="button"
                className="btn"
                disabled={loadingPreview && !deepScanning}
                onClick={() => (deepScanning ? handleCancelDeepScan() : void handleDeepScan())}
                title="扫描整个用户主目录查找未登记技能，完成后进入预览"
              >
                <span className={deepScanning ? 'organize-search-busy' : 'organize-search-icon'}>
                  <IconSearch size={16} />
                </span>
                <span>{deepScanning ? '取消扫描' : '深度扫描'}</span>
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* 5 个核心指标看板卡片 (KPI Summary Grid) */}
          <section className="organize-kpis" aria-label="整理动作统计">
            <div
              className={`organize-kpi-card ${
                metrics.moveToHubCount === 0 ? 'is-zero' : 'is-highlight tone-move'
              } ${selectedTypeFilter === 'move_to_hub' ? 'is-active' : ''}`}
              onClick={() =>
                setSelectedTypeFilter((curr) =>
                  curr === 'move_to_hub' ? 'all' : 'move_to_hub',
                )
              }
              title="点击按「待迁入源仓」筛选"
            >
              <div className="organize-kpi-card-head">
                <span className="organize-kpi-title">待迁入源仓</span>
                <div className="organize-kpi-icon-wrap tone-move">
                  <IconFolderPlus size={16} />
                </div>
              </div>
              <div className="organize-kpi-value-row">
                <span className="organize-kpi-number">{metrics.moveToHubCount}</span>
                <span className="organize-kpi-unit">项</span>
              </div>
              <span className="organize-kpi-desc">
                {metrics.moveToHubCount === 0 ? '散落副本已全部归集' : '将散落副本搬入源仓'}
              </span>
            </div>

            <div
              className={`organize-kpi-card ${
                metrics.replaceWithSymlinkCount === 0 ? 'is-zero' : 'is-highlight tone-link'
              } ${selectedTypeFilter === 'replace_with_symlink' ? 'is-active' : ''}`}
              onClick={() =>
                setSelectedTypeFilter((curr) =>
                  curr === 'replace_with_symlink' ? 'all' : 'replace_with_symlink',
                )
              }
              title="点击按「待替换软链」筛选"
            >
              <div className="organize-kpi-card-head">
                <span className="organize-kpi-title">待替换软链</span>
                <div className="organize-kpi-icon-wrap tone-link">
                  <IconLink size={16} />
                </div>
              </div>
              <div className="organize-kpi-value-row">
                <span className="organize-kpi-number">{metrics.replaceWithSymlinkCount}</span>
                <span className="organize-kpi-unit">项</span>
              </div>
              <span className="organize-kpi-desc">
                {metrics.replaceWithSymlinkCount === 0 ? '符号链接均已就绪' : '在工具目录创建链接'}
              </span>
            </div>

            <div
              className={`organize-kpi-card ${
                metrics.mergeConflictCount === 0 ? 'is-zero' : 'is-highlight tone-conflict'
              } ${selectedTypeFilter === 'merge_conflict' ? 'is-active' : ''}`}
              onClick={() => {
                if (attentionConflictCount > 0) {
                  openConflictDialog()
                } else {
                  setSelectedTypeFilter((curr) =>
                    curr === 'merge_conflict' ? 'all' : 'merge_conflict',
                  )
                }
              }}
              title={
                attentionConflictCount > 0
                  ? '点击立即打开冲突合并工作台'
                  : '点击按「内容冲突」筛选'
              }
            >
              <div className="organize-kpi-card-head">
                <span className="organize-kpi-title">内容冲突</span>
                <div className="organize-kpi-icon-wrap tone-conflict">
                  <IconAlertTriangle size={16} />
                </div>
              </div>
              <div className="organize-kpi-value-row">
                <span className="organize-kpi-number">{metrics.mergeConflictCount}</span>
                <span className="organize-kpi-unit">项</span>
              </div>
              <span className="organize-kpi-desc">
                {attentionConflictCount > 0
                  ? `⚠️ ${attentionConflictCount} 项待人工决议`
                  : metrics.mergeConflictCount > 0
                    ? '✓ 冲突已全部决议'
                    : '无同名版本冲突'}
              </span>
            </div>

            <div
              className={`organize-kpi-card ${
                metrics.fixLinkCount === 0 ? 'is-zero' : 'is-highlight tone-fix'
              } ${selectedTypeFilter === 'fix_link' ? 'is-active' : ''}`}
              onClick={() =>
                setSelectedTypeFilter((curr) =>
                  curr === 'fix_link' ? 'all' : 'fix_link',
                )
              }
              title="点击按「修复断链」筛选"
            >
              <div className="organize-kpi-card-head">
                <span className="organize-kpi-title">修复断链</span>
                <div className="organize-kpi-icon-wrap tone-fix">
                  <IconWrench size={16} />
                </div>
              </div>
              <div className="organize-kpi-value-row">
                <span className="organize-kpi-number">{metrics.fixLinkCount}</span>
                <span className="organize-kpi-unit">项</span>
              </div>
              <span className="organize-kpi-desc">
                {metrics.fixLinkCount === 0 ? '无失效或损坏链接' : '纠偏修复损坏的链接'}
              </span>
            </div>

            <div
              className={`organize-kpi-card ${
                metrics.skipCount + metrics.userSkippedCount === 0
                  ? 'is-zero'
                  : 'is-highlight tone-skip'
              } ${selectedTypeFilter === 'skip' ? 'is-active' : ''}`}
              onClick={() =>
                setSelectedTypeFilter((curr) => (curr === 'skip' ? 'all' : 'skip'))
              }
              title="点击按「保持跳过」筛选"
            >
              <div className="organize-kpi-card-head">
                <span className="organize-kpi-title">保持跳过</span>
                <div className="organize-kpi-icon-wrap tone-skip">
                  <IconCheck size={16} />
                </div>
              </div>
              <div className="organize-kpi-value-row">
                <span className="organize-kpi-number">
                  {metrics.skipCount + metrics.userSkippedCount}
                </span>
                <span className="organize-kpi-unit">项</span>
              </div>
              <span className="organize-kpi-desc">
                {metrics.skipCount + metrics.userSkippedCount === 0
                  ? '无跳过项目'
                  : '已规范或手动跳过'}
              </span>
            </div>
          </section>

          {/* 筛选与搜索控制栏 (Filter Deck) */}
          <section className="organize-filter-deck">
            <div className="organize-filter-row">
              <div className="organize-segmented-tabs" role="tablist">
                <button
                  type="button"
                  className={`organize-filter-tab ${
                    selectedTypeFilter === 'all' ? 'is-active' : ''
                  }`}
                  onClick={() => setSelectedTypeFilter('all')}
                >
                  <span>全部动作</span>
                  <span className="organize-tab-count">{metrics.totalActions}</span>
                </button>
                <button
                  type="button"
                  className={`organize-filter-tab ${
                    selectedTypeFilter === 'move_to_hub' ? 'is-active' : ''
                  }`}
                  onClick={() => setSelectedTypeFilter('move_to_hub')}
                >
                  <span>待迁入源仓</span>
                  <span className="organize-tab-count">{metrics.moveToHubCount}</span>
                </button>
                <button
                  type="button"
                  className={`organize-filter-tab ${
                    selectedTypeFilter === 'replace_with_symlink' ? 'is-active' : ''
                  }`}
                  onClick={() => setSelectedTypeFilter('replace_with_symlink')}
                >
                  <span>待替换软链</span>
                  <span className="organize-tab-count">
                    {metrics.replaceWithSymlinkCount}
                  </span>
                </button>
                {metrics.mergeConflictCount > 0 ? (
                  <button
                    type="button"
                    className={`organize-filter-tab ${
                      selectedTypeFilter === 'merge_conflict' ? 'is-active' : ''
                    }`}
                    onClick={() => setSelectedTypeFilter('merge_conflict')}
                  >
                    <span>内容冲突</span>
                    <span
                      className={`organize-tab-count ${
                        attentionConflictCount > 0 ? 'is-attention' : ''
                      }`}
                    >
                      {metrics.mergeConflictCount}
                    </span>
                  </button>
                ) : null}
                {metrics.fixLinkCount > 0 ? (
                  <button
                    type="button"
                    className={`organize-filter-tab ${
                      selectedTypeFilter === 'fix_link' ? 'is-active' : ''
                    }`}
                    onClick={() => setSelectedTypeFilter('fix_link')}
                  >
                    <span>修复断链</span>
                    <span className="organize-tab-count">{metrics.fixLinkCount}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`organize-filter-tab ${
                    selectedTypeFilter === 'skip' ? 'is-active' : ''
                  }`}
                  onClick={() => setSelectedTypeFilter('skip')}
                >
                  <span>保持跳过</span>
                  <span className="organize-tab-count">
                    {metrics.skipCount + metrics.userSkippedCount}
                  </span>
                </button>
              </div>

              <div className="organize-search-box">
                <IconSearch size={15} />
                <input
                  type="search"
                  className="organize-search-input"
                  placeholder="搜索技能 ID、来源路径…"
                  value={actionQuery}
                  onChange={(e) => setActionQuery(e.target.value)}
                  aria-label="搜索执行计划"
                />
                {actionQuery ? (
                  <button
                    type="button"
                    className="organize-search-clear"
                    onClick={() => setActionQuery('')}
                    title="清空搜索"
                  >
                    <IconX size={14} />
                  </button>
                ) : null}
              </div>
            </div>

            {selectionAll.toggleableCount > 0 ? (
              <div className="organize-filter-row" style={{paddingTop: 4}}>
                <div className="organize-batch-controls">
                  <label className="organize-select-all">
                    <input
                      type="checkbox"
                      className="organize-checkbox"
                      checked={selectionAll.checked}
                      disabled={executing || visibleSelectableIndices.length === 0}
                      ref={(el) => {
                        if (el) el.indeterminate = selectionAll.indeterminate
                      }}
                      onChange={(e) =>
                        void handleToggleIndices(
                          visibleSelectableIndices,
                          e.target.checked,
                        )
                      }
                      aria-label="全选当前筛选结果"
                    />
                    <span>全选当前筛选</span>
                    <span className="muted">
                      （已勾选 {selectionAll.selectedCount} / 可选{' '}
                      {selectionAll.toggleableCount}）
                    </span>
                  </label>
                </div>

                <div className="organize-batch-controls">
                  <button
                    type="button"
                    className="organize-batch-btn"
                    disabled={executing || visibleSelectableIndices.length === 0}
                    onClick={() => void handleToggleIndices(visibleSelectableIndices, true)}
                  >
                    全部选中
                  </button>
                  <button
                    type="button"
                    className="organize-batch-btn"
                    disabled={executing || visibleSelectableIndices.length === 0}
                    onClick={() => void handleToggleIndices(visibleSelectableIndices, false)}
                  >
                    全部取消
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          {/* 当所有技能已处于规范状态时展示健康状态卡片 */}
          {metrics.toggleableCount === 0 && metrics.totalActions > 0 && !actionQuery && selectedTypeFilter === 'all' ? (
            <div className="organize-healthy-banner">
              <div className="organize-healthy-icon">
                <IconShieldCheck size={20} />
              </div>
              <div className="organize-healthy-content">
                <span className="organize-healthy-title">
                  所有技能均已处于标准规范状态
                </span>
                <span className="organize-healthy-subtitle">
                  共检测到 {metrics.totalActions} 项技能，已全部建立有效符号链接或规范存储于中心源仓，无需执行任何迁移或变更。
                </span>
              </div>
            </div>
          ) : null}

          {/* 动作清单面板 (Actions Deck) */}
          <section className="organize-actions-deck">
            {actions.length === 0 ? (
              <div className="empty-state">暂无动作需要执行。</div>
            ) : filteredActionSections.length === 0 ? (
              <div className="empty-state" style={{padding: '32px 16px'}}>
                <p className="muted" style={{margin: '0 0 12px'}}>
                  未找到符合「{actionQuery}」的动作项
                </p>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setActionQuery('')
                    setSelectedTypeFilter('all')
                  }}
                >
                  清除筛选与搜索
                </button>
              </div>
            ) : (
              filteredActionSections.map((sec) => {
                const collapsed = collapsedActionTypes.has(sec.type)
                const config = ACTION_CONFIG[sec.type] ?? {
                  label: sec.type,
                  description: '',
                  icon: IconFolderSync,
                  toneClass: 'type-skip',
                }
                const ActionIcon = config.icon
                const sectionSelection = organizeSelectionState(
                  sec.items.map(({action}) => action),
                )
                const sectionSelectableIndices = sec.items
                  .filter(({action}) => isOrganizeActionSelectable(action.type))
                  .map(({index}) => index)

                return (
                  <div className="organize-group-block" key={sec.type}>
                    <div
                      className="organize-group-header-row"
                      onClick={() => toggleActionGroupCollapse(sec.type)}
                      aria-expanded={!collapsed}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          toggleActionGroupCollapse(sec.type)
                        }
                      }}
                    >
                      <div className="organize-group-title-wrap">
                        <span
                          className={`organize-group-chevron-icon ${
                            !collapsed ? 'is-open' : ''
                          }`}
                          aria-hidden="true"
                        >
                          <IconChevron size={14} />
                        </span>
                        <div className="organize-group-badge">
                          <div className={`organize-group-type-icon ${config.toneClass}`}>
                            <ActionIcon size={14} />
                          </div>
                          <span className="organize-group-label">{config.label}</span>
                          <span className="organize-group-count-pill">
                            {sec.items.length}
                          </span>
                        </div>
                      </div>

                      {sectionSelection.toggleableCount > 0 ? (
                        <div
                          className="organize-group-actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <label className="organize-select-all organize-select-all-th">
                            <input
                              type="checkbox"
                              className="organize-checkbox"
                              checked={sectionSelection.checked}
                              disabled={executing}
                              ref={(el) => {
                                if (el)
                                  el.indeterminate =
                                    sectionSelection.indeterminate
                              }}
                              onChange={(e) =>
                                void handleToggleIndices(
                                  sectionSelectableIndices,
                                  e.target.checked,
                                )
                              }
                              aria-label={`全选${config.label}`}
                            />
                            <span>全选此类</span>
                          </label>
                        </div>
                      ) : null}
                    </div>

                    {!collapsed ? (
                      <div className="organize-table-wrap">
                        <table className="organize-table">
                          <colgroup>
                            <col className="organize-col-check" />
                            <col className="organize-col-skill" />
                            <col className="organize-col-source" />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="organize-th-check">选中</th>
                              <th>技能名称 / ID</th>
                              <th>来源路径与对应工具</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sec.items.map(({action, index}) => {
                              const conflict =
                                action.type === 'merge_conflict'
                                  ? conflicts.find((x) => x.skillId === action.skillId)
                                  : undefined
                              const conflictDecided =
                                Boolean(conflict) &&
                                !conflictSkillNeedsAttention(conflict!)
                              const selectable = isOrganizeActionSelectable(action.type)

                              return (
                                <tr key={`${action.skillId}-${index}`}>
                                  <td style={{textAlign: 'center'}}>
                                    <input
                                      type="checkbox"
                                      className="organize-checkbox"
                                      checked={Boolean(action.selected)}
                                      disabled={!selectable || executing}
                                      onChange={(e) =>
                                        void handleToggleSelected(
                                          index,
                                          e.target.checked,
                                        )
                                      }
                                      aria-label={`选中 ${action.skillId}`}
                                    />
                                  </td>

                                  <td>
                                    <OrganizeSkillIdentity
                                      skillId={action.skillId}
                                      trailing={
                                        <>
                                          <button
                                            type="button"
                                            className="organize-copy-btn"
                                            title="复制技能 ID"
                                            onClick={() =>
                                              copyText(action.skillId, `skill-${index}`)
                                            }
                                          >
                                            {copiedId === `skill-${index}` ? (
                                              <IconCheck size={13} style={{color: '#15803d'}} />
                                            ) : (
                                              <IconCopy size={13} />
                                            )}
                                          </button>
                                          {action.type === 'merge_conflict' ? (
                                            conflictDecided ? (
                                              <span className="organize-conflict-status-pill is-done">
                                                <IconCheck size={11} />
                                                已决议
                                              </span>
                                            ) : (
                                              <span className="organize-conflict-status-pill is-diff">
                                                <IconAlertTriangle size={11} />
                                                待决议
                                              </span>
                                            )
                                          ) : null}
                                          {action.type === 'merge_conflict' ? (
                                            <button
                                              type="button"
                                              className="link-btn"
                                              onClick={() =>
                                                openConflictDialog(action.skillId)
                                              }
                                              style={{fontSize: 12}}
                                            >
                                              {conflictDecided ? '查看对比' : '处理冲突'}
                                            </button>
                                          ) : null}
                                        </>
                                      }
                                    />
                                  </td>

                                  <td>
                                    <div className="organize-sources-cell">
                                      {(action.sources ?? []).length === 0 ? (
                                        <span className="muted">—</span>
                                      ) : (
                                        (action.sources ?? []).map((src, sIdx) => {
                                          const detected = detectToolFromPath(src)
                                          const badge = detected
                                            ? getToolBadge(detected.id)
                                            : null

                                          return (
                                            <div
                                              className="organize-source-item"
                                              key={sIdx}
                                            >
                                              {badge ? (
                                                <span
                                                  className="organize-tool-badge"
                                                  style={{
                                                    background: badge.gradient,
                                                    boxShadow: `0 1px 4px ${badge.shadowColor}`,
                                                  }}
                                                  title={`来源工具: ${badge.displayName}`}
                                                >
                                                  {badge.displayName}
                                                </span>
                                              ) : (
                                                <span
                                                  className="organize-tool-badge"
                                                  style={{background: '#64748b'}}
                                                  title="外部工作目录来源"
                                                >
                                                  外部
                                                </span>
                                              )}
                                              <OrganizeSourcePath path={src} />
                                              <button
                                                type="button"
                                                className="organize-copy-btn"
                                                title="复制完整路径"
                                                onClick={() =>
                                                  copyText(src, `src-${index}-${sIdx}`)
                                                }
                                              >
                                                {copiedId === `src-${index}-${sIdx}` ? (
                                                  <IconCheck
                                                    size={12}
                                                    style={{color: '#15803d'}}
                                                  />
                                                ) : (
                                                  <IconCopy size={12} />
                                                )}
                                              </button>
                                            </div>
                                          )
                                        })
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}
          </section>
        </>
      )}

      {/* 执行报告弹窗 */}
      {reportOpen && report ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog dialog-report"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-conflict-head">
              <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                <IconActivity size={18} style={{color: 'var(--accent)'}} />
                <h2 id="report-dialog-title">执行整理报告</h2>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setReportOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="report-dialog-body">
              <ReportPanel report={report} onCopy={copyText} copiedId={copiedId} />
            </div>
          </div>
        </div>
      ) : null}

      {/* 外部工作目录添加建议弹窗 */}
      {workdirDialogOpen && workdirSuggestions.length > 0 ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog dialog-workdir-suggest"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workdir-suggest-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-conflict-head">
              <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                <IconFolderPlus size={18} style={{color: 'var(--accent)'}} />
                <h2 id="workdir-suggest-title">发现外部工作目录，是否加入日常管理？</h2>
              </div>
              <button type="button" className="btn" onClick={closeWorkdirDialog}>
                跳过
              </button>
            </div>
            <p className="muted workdir-suggest-desc">
              添加后将参与后续的自动扫描；并为本次已迁入源仓的 Skill 建立指向源仓的符号链接。
            </p>
            {workdirDialogError ? (
              <div className="dialog-error">{workdirDialogError}</div>
            ) : null}
            <div className="page-toolbar compact">
              <button type="button" className="btn" onClick={selectAllWorkdirs}>
                全选
              </button>
              <button type="button" className="btn" onClick={deselectAllWorkdirs}>
                取消全选
              </button>
            </div>
            <ul className="workdir-suggest-list">
              {workdirSuggestions.map((sug) => (
                <li key={sug.path}>
                  <label className="workdir-suggest-item">
                    <input
                      type="checkbox"
                      className="organize-checkbox"
                      checked={workdirSelected.has(sug.path)}
                      onChange={() => toggleWorkdirSelected(sug.path)}
                    />
                    <span className="workdir-suggest-text">
                      <span className="mono path-line">{sug.path}</span>
                      <span className="muted">涉及 {sug.skillCount} 个 skill</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={closeWorkdirDialog}>
                暂不添加
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={confirmingWorkdirs || workdirSelected.size === 0}
                onClick={() => void handleConfirmAddWorkdirs()}
              >
                {confirmingWorkdirs ? '添加中…' : `添加所选 (${workdirSelected.size})`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 恢复误迁链接弹窗 */}
      {restoreDialogOpen && restoreItems.length > 0 ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog dialog-workdir-suggest"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-orphan-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-conflict-head">
              <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                <IconRotateCcw size={18} style={{color: 'var(--accent)'}} />
                <h2 id="restore-orphan-title">恢复误迁的符号链接</h2>
              </div>
              <button type="button" className="btn" onClick={closeRestoreDialog}>
                关闭
              </button>
            </div>
            <p className="muted workdir-suggest-desc">
              这些路径当前是指向源仓的符号链接（通常是在深度扫描时误建的）。恢复后会删除符号链接，并把源仓中的真实目录安全移回原位置。
            </p>
            {restoreDialogError ? (
              <div className="dialog-error">{restoreDialogError}</div>
            ) : null}
            <div className="page-toolbar compact">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setRestoreSelected(new Set(restoreItems.map((i) => i.linkPath)))
                }
              >
                全选
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setRestoreSelected(new Set())}
              >
                取消全选
              </button>
            </div>
            <ul className="workdir-suggest-list">
              {restoreItems.map((item) => (
                <li key={item.linkPath}>
                  <label className="workdir-suggest-item">
                    <input
                      type="checkbox"
                      className="organize-checkbox"
                      checked={restoreSelected.has(item.linkPath)}
                      onChange={() => toggleRestoreSelected(item.linkPath)}
                    />
                    <span className="workdir-suggest-text">
                      <span
                        className="mono path-line"
                        style={{fontWeight: 700, color: 'var(--text)'}}
                      >
                        {item.skillId}
                      </span>
                      <span className="mono path-line muted">链接: {item.linkPath}</span>
                      <span className="mono path-line muted">源仓: {item.targetPath}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={closeRestoreDialog}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={restoringOrphans || restoreSelected.size === 0}
                onClick={() => void handleConfirmRestoreOrphans()}
              >
                {restoringOrphans ? '恢复中…' : `确认恢复 (${restoreSelected.size})`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 冲突合并全功能工作台弹窗 */}
      {conflictOpen && conflicts.length > 0 ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className={`dialog dialog-conflict ${isConflictMaximized ? 'is-maximized' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="conflict-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 现代化沉浸工作台 Header */}
            <div className="dialog-conflict-head">
              <div className="dialog-conflict-brand">
                <div className="conflict-brand-icon-wrap" aria-hidden="true">
                  <IconGitMerge size={19} />
                </div>
                <div className="conflict-title-group">
                  <div className="conflict-title-row">
                    <h2 id="conflict-dialog-title">冲突合并工作台</h2>
                    {(() => {
                      const totalSkills = conflicts.length
                      const readySkills = conflicts.filter((c) => conflictFilesReady(c)).length
                      const allReady = readySkills >= totalSkills
                      return (
                        <span
                          className={`conflict-global-badge ${allReady ? 'is-ready' : 'is-pending'}`}
                        >
                          {allReady ? (
                            <>
                              <IconCheck size={12} />
                              <span>全部技能已就绪</span>
                            </>
                          ) : (
                            <>
                              <span className="pulse-indicator" />
                              <span>
                                待决议 {totalSkills - readySkills} / {totalSkills} 个技能
                              </span>
                            </>
                          )}
                        </span>
                      )
                    })()}
                  </div>
                  <span className="conflict-subtitle">
                    逐一审查源仓与待迁入来源之间的冲突，完成行级或文件级决议
                  </span>
                </div>
              </div>

              <div className="dialog-conflict-window-actions">
                <button
                  type="button"
                  className="conflict-window-btn"
                  title={isConflictMaximized ? '还原窗口' : '最大化全屏工作台'}
                  onClick={() => setIsConflictMaximized((prev) => !prev)}
                >
                  {isConflictMaximized ? <IconMinimize size={15} /> : <IconMaximize size={15} />}
                </button>
                <button
                  type="button"
                  className="conflict-window-btn btn-close"
                  onClick={closeConflictDialog}
                  title="关闭工作台（进度将自动保留）"
                >
                  <IconX size={16} />
                </button>
              </div>
            </div>

            {dialogError ? <div className="dialog-error">{dialogError}</div> : null}

            {/* 冲突技能切换选项卡 */}
            <div className="conflict-tabs-container">
              <div className="conflict-tabs-scroll conflict-tabs">
                {conflicts.map((c) => {
                  const {resolved, total} = conflictFileProgress(c)
                  const isDecided = resolved >= total && total > 0
                  const isSkipped = Boolean(c.userSkipped)
                  const percent = total > 0 ? Math.min(100, Math.round((resolved / total) * 100)) : 100
                  const isActive = activeConflict?.skillId === c.skillId

                  return (
                    <button
                      key={c.skillId}
                      type="button"
                      className={`conflict-tab-card ${isActive ? 'is-active' : ''} ${
                        isDecided ? 'is-decided' : ''
                      } ${isSkipped ? 'is-skipped' : ''}`}
                      onClick={() => {
                        setActiveConflictId(c.skillId)
                        setDialogError('')
                      }}
                    >
                      <div className="tab-card-header">
                        <span className="mono tab-skill-name" title={c.skillId}>
                          {c.skillId}
                        </span>
                        {isSkipped ? (
                          <span className="tab-status-chip is-muted">已跳过</span>
                        ) : isDecided ? (
                          <span className="tab-status-chip is-done">
                            <IconCheck size={11} />
                            <span>完成</span>
                          </span>
                        ) : total > 0 ? (
                          <span className="tab-status-chip is-attention">
                            {resolved}/{total}
                          </span>
                        ) : (
                          <span className="tab-status-chip is-neutral">无需改动</span>
                        )}
                      </div>

                      {/* 卡片底边微型进度槽 */}
                      <div className="tab-card-progress">
                        <div
                          className={`tab-card-progress-bar ${
                            isSkipped ? 'is-skipped' : isDecided ? 'is-done' : 'is-pending'
                          }`}
                          style={{width: `${percent}%`}}
                        />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {activeConflict ? (
              <ConflictPanel
                key={`${activeConflict.skillId}:${activeConflict.index}:${activeConflict.sideA}:${activeConflict.sideB}`}
                conflict={activeConflict}
                canApplyRound={conflictRoundNeedsApply(activeConflict)}
                applyingRound={applyingRound}
                onSkip={() => void handleSkip(activeConflict.skillId)}
                onReset={() => void handleReset(activeConflict.skillId)}
                onApplyRound={() => void handleApplyRound(activeConflict.skillId)}
                onChoice={(rel, choice, merged) =>
                  void handleChoice(activeConflict.skillId, rel, choice, merged)
                }
              />
            ) : null}

            {/* 底部状态总览与完成按钮 */}
            <div className="dialog-actions dialog-conflict-footer">
              <div className="conflict-footer-summary">
                {(() => {
                  const total = conflicts.length
                  const ready = conflicts.filter((c) => conflictFilesReady(c)).length
                  const allDone = ready >= total
                  return (
                    <div className="conflict-progress-overview">
                      <div className="overview-text">
                        <span className="overview-label">整体决议进度：</span>
                        <span className={`overview-count ${allDone ? 'is-all-done' : ''}`}>
                          {ready} / {total} 技能就绪
                        </span>
                      </div>
                      <div className="overview-track">
                        <div
                          className="overview-bar"
                          style={{width: `${total > 0 ? Math.round((ready / total) * 100) : 100}%`}}
                        />
                      </div>
                    </div>
                  )
                })()}
              </div>

              <div className="conflict-footer-buttons">
                <button
                  type="button"
                  className="btn btn-primary btn-done"
                  onClick={closeConflictDialog}
                >
                  <IconCheck size={15} />
                  <span>完成并返回列表</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function getConflictFileIcon(relPath: string, isText: boolean) {
  if (!isText) {
    return <IconFileBinary size={15} className="conflict-type-icon is-binary" />
  }
  const lower = relPath.toLowerCase()
  if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.rst')) {
    return <IconFileText size={15} className="conflict-type-icon is-doc" />
  }
  if (
    lower.endsWith('.py') ||
    lower.endsWith('.js') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.go') ||
    lower.endsWith('.sh') ||
    lower.endsWith('.ps1') ||
    lower.endsWith('.json') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.toml')
  ) {
    return <IconFileCode size={15} className="conflict-type-icon is-code" />
  }
  return <IconFile size={15} className="conflict-type-icon is-generic" />
}

function ConflictPanel({
  conflict,
  canApplyRound,
  applyingRound,
  onSkip,
  onReset,
  onApplyRound,
  onChoice,
}: {
  conflict: ConflictSkill
  canApplyRound: boolean
  applyingRound: boolean
  onSkip: () => void
  onReset: () => void
  onApplyRound: () => void
  onChoice: (rel: string, choice: string, merged: string) => void
}) {
  const files = conflict.files ?? []
  const firstDiff =
    files.find((f) => f.status === 'both_diff')?.relativePath ??
    files[0]?.relativePath ??
    ''
  const [selectedRel, setSelectedRel] = useState(firstDiff)
  const [fileFilter, setFileFilter] = useState<'all' | 'diff' | 'pending'>('all')
  const [copiedSide, setCopiedSide] = useState<'a' | 'b' | null>(null)
  const [textA, setTextA] = useState('')
  const [textB, setTextB] = useState('')
  const [loadingTexts, setLoadingTexts] = useState(true)
  const [textError, setTextError] = useState('')

  const selected =
    files.find((f) => f.relativePath === selectedRel) ??
    files.find((f) => f.status === 'both_diff') ??
    files[0] ??
    null

  useEffect(() => {
    const stillThere = files.some((f) => f.relativePath === selectedRel)
    if (!stillThere) {
      setSelectedRel(firstDiff)
    }
  }, [conflict.skillId, files, firstDiff, selectedRel])

  useEffect(() => {
    if (!selected || selected.status !== 'both_diff' || !selected.isText) {
      setTextA('')
      setTextB('')
      setTextError('')
      setLoadingTexts(false)
      return
    }
    let cancelled = false
    setLoadingTexts(true)
    setTextError('')
    void ReadConflictFileTexts(conflict.skillId, selected.relativePath)
      .then((texts) => {
        if (cancelled) return
        setTextA(texts?.sideA ?? '')
        setTextB(texts?.sideB ?? '')
      })
      .catch((e) => {
        if (cancelled) return
        setTextA('')
        setTextB('')
        setTextError(errMsg(e))
      })
      .finally(() => {
        if (!cancelled) setLoadingTexts(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    conflict.skillId,
    conflict.sideA,
    conflict.sideB,
    conflict.index,
    selected?.relativePath,
    selected?.status,
    selected?.isText,
  ])

  function handleCopyPath(path: string, side: 'a' | 'b') {
    void navigator.clipboard.writeText(path).then(() => {
      setCopiedSide(side)
      setTimeout(() => setCopiedSide(null), 1800)
    })
  }

  const choice = selected?.choice ?? ''
  const needsChoice = selected?.status === 'both_diff'

  const diffFiles = useMemo(() => files.filter((f) => f.status === 'both_diff'), [files])
  const pendingFiles = useMemo(
    () => diffFiles.filter((f) => !bothDiffResolved(f)),
    [diffFiles],
  )
  const resolvedCount = diffFiles.length - pendingFiles.length

  const filteredFiles = useMemo(() => {
    if (fileFilter === 'diff') return diffFiles
    if (fileFilter === 'pending') return pendingFiles
    return files
  }, [files, diffFiles, pendingFiles, fileFilter])

  return (
    <div className="conflict-panel">
      {/* 来源对比与技能动作集成工具条 */}
      <div className="conflict-context-bar">
        <div className="conflict-paths-strip">
          <div className="conflict-path-pill path-a">
            <span className="side-badge badge-a">侧 A · 源仓</span>
            <span className="mono path-line" title={conflict.sideA}>
              {conflict.sideA}
            </span>
            <button
              type="button"
              className="path-copy-btn"
              title="复制侧 A 路径"
              onClick={() => handleCopyPath(conflict.sideA, 'a')}
            >
              {copiedSide === 'a' ? <IconCheck size={12} /> : <IconCopy size={12} />}
            </button>
          </div>

          <div className="conflict-path-arrow" aria-hidden="true">
            <IconArrowRight size={14} />
          </div>

          <div className="conflict-path-pill path-b">
            <span className="side-badge badge-b">侧 B · 待迁入</span>
            <span className="mono path-line" title={conflict.sideB}>
              {conflict.sideB}
            </span>
            <button
              type="button"
              className="path-copy-btn"
              title="复制侧 B 路径"
              onClick={() => handleCopyPath(conflict.sideB, 'b')}
            >
              {copiedSide === 'b' ? <IconCheck size={12} /> : <IconCopy size={12} />}
            </button>
          </div>
        </div>

        <div className="conflict-skill-actions">
          {conflict.total > 1 ? (
            <span className="organize-action-pill type-replace_with_symlink">
              轮次 {conflict.index || 1} / {conflict.total}
            </span>
          ) : null}
          {conflict.userSkipped ? (
            <span className="organize-action-pill type-skip">已跳过</span>
          ) : null}

          <button
            type="button"
            className={`btn btn-sm ${conflict.userSkipped ? 'btn-active' : ''}`}
            onClick={onSkip}
            title={conflict.userSkipped ? '取消跳过状态' : '在整理执行中跳过此技能'}
          >
            {conflict.userSkipped ? '已跳过此技能' : '跳过该技能'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onReset}
            title="清空当前技能的所有文件决议"
          >
            <IconRotateCcw size={12} />
            <span>重置决议</span>
          </button>
          {canApplyRound ? (
            <button
              type="button"
              className="btn btn-sm btn-primary conflict-apply-round-btn"
              disabled={applyingRound}
              onClick={onApplyRound}
            >
              {applyingRound ? '应用中…' : '应用本轮合并 (进入下一轮)'}
            </button>
          ) : null}
        </div>
      </div>

      {/* 主体双栏区域 */}
      <div className="conflict-layout">
        {/* 左侧文件清单侧栏 */}
        <div className="conflict-file-list">
          <div className="conflict-list-header">
            <div className="list-title-row">
              <span className="list-title">文件清单</span>
              <span className="list-count-badge">{files.length}</span>
            </div>

            {/* 快速筛选分段控制器 */}
            <div className="conflict-list-filter-bar">
              <button
                type="button"
                className={`list-filter-tab ${fileFilter === 'all' ? 'is-active' : ''}`}
                onClick={() => setFileFilter('all')}
              >
                全部 ({files.length})
              </button>
              <button
                type="button"
                className={`list-filter-tab ${fileFilter === 'diff' ? 'is-active' : ''}`}
                onClick={() => setFileFilter('diff')}
              >
                差异 ({diffFiles.length})
              </button>
              {pendingFiles.length > 0 ? (
                <button
                  type="button"
                  className={`list-filter-tab is-pending-tab ${
                    fileFilter === 'pending' ? 'is-active' : ''
                  }`}
                  onClick={() => setFileFilter('pending')}
                >
                  待决 ({pendingFiles.length})
                </button>
              ) : null}
            </div>
          </div>

          <ul className="conflict-file-items">
            {filteredFiles.map((file) => {
              const active = file.relativePath === selected?.relativePath
              const isDiff = file.status === 'both_diff'
              const resolved = bothDiffResolved(file)

              // 拆分路径与主文件名
              const lastSlash = file.relativePath.lastIndexOf('/')
              const dirPart = lastSlash >= 0 ? file.relativePath.slice(0, lastSlash + 1) : ''
              const namePart = lastSlash >= 0 ? file.relativePath.slice(lastSlash + 1) : file.relativePath

              return (
                <li key={file.relativePath}>
                  <button
                    type="button"
                    className={`conflict-file-item ${active ? 'active' : ''} ${
                      isDiff ? (resolved ? 'is-diff-done' : 'is-diff') : 'is-non-diff'
                    }`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => setSelectedRel(file.relativePath)}
                  >
                    <div className="conflict-file-main-row">
                      <div className="file-icon-wrap" aria-hidden="true">
                        {getConflictFileIcon(file.relativePath, file.isText)}
                      </div>
                      <div className="file-name-meta">
                        {dirPart ? <span className="file-dir mono">{dirPart}</span> : null}
                        <span className="file-basename mono">{namePart}</span>
                      </div>
                    </div>

                    <div className="conflict-file-meta-row">
                      {isDiff ? (
                        resolved ? (
                          <span className="file-badge is-resolved">
                            <IconCheck size={10} />
                            <span>
                              {file.choice === 'keep_a'
                                ? '保留侧 A'
                                : file.choice === 'keep_b'
                                  ? '保留侧 B'
                                  : '手动混排'}
                            </span>
                          </span>
                        ) : (
                          <span className="file-badge is-pending">
                            <span className="badge-dot" />
                            <span>待决议</span>
                          </span>
                        )
                      ) : file.status === 'both_same' ? (
                        <span className="file-badge is-same">两侧相同</span>
                      ) : file.status === 'only_a' ? (
                        <span className="file-badge is-only-a">仅侧 A (保留)</span>
                      ) : file.status === 'only_b' ? (
                        <span className="file-badge is-only-b">仅侧 B (保留)</span>
                      ) : (
                        <span className="file-badge is-other">{file.status}</span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
            {filteredFiles.length === 0 ? (
              <li className="conflict-file-empty">无匹配文件</li>
            ) : null}
          </ul>
        </div>

        {/* 右侧比对与合并区 */}
        <div className="conflict-detail">
          {!selected ? (
            <div className="conflict-empty-pane">
              <IconFile size={32} />
              <p>请在左侧选择需要对比或审查的文件</p>
            </div>
          ) : (
            <>
              {/* 文件标题与类型条 */}
              <div className="conflict-detail-header-card">
                <div className="detail-header-left">
                  <div className="detail-file-icon">
                    {getConflictFileIcon(selected.relativePath, selected.isText)}
                  </div>
                  <div className="detail-title-info">
                    <span className="detail-filename mono">{selected.relativePath}</span>
                    <span className="detail-type-hint">
                      {selected.isText ? '文本文件 · 支持逐行审查' : '二进制文件 · 支持版本选择'}
                    </span>
                  </div>
                </div>

                <div className="detail-header-right">
                  {selected.status === 'both_diff' ? (
                    bothDiffResolved(selected) ? (
                      <span className="detail-resolved-pill">
                        <IconCheck size={12} />
                        <span>已完成决议</span>
                      </span>
                    ) : (
                      <span className="detail-pending-pill">
                        <span className="badge-dot" />
                        <span>存在差异 · 待解决</span>
                      </span>
                    )
                  ) : (
                    <span className="detail-neutral-pill">
                      {FILE_STATUS_LABELS[selected.status] ?? selected.status}
                    </span>
                  )}
                </div>
              </div>

              {/* 文本差异对比与合并 */}
              {needsChoice && selected.isText ? (
                <>
                  {textError ? <div className="dialog-error">{textError}</div> : null}
                  {loadingTexts ? (
                    <div className="conflict-loading-pane">
                      <div className="spinner" />
                      <span>正在读取双侧文件文本对比…</span>
                    </div>
                  ) : null}
                  {!loadingTexts && !textError ? (
                    <ThreeWayMerge
                      key={`${conflict.skillId}:${conflict.index}:${conflict.sideA}:${conflict.sideB}:${selected.relativePath}`}
                      textA={textA}
                      textB={textB}
                      value={
                        choice === 'keep_a'
                          ? textA
                          : choice === 'keep_b'
                            ? textB
                            : choice === 'manual'
                              ? selected.mergedContent ?? ''
                              : ''
                      }
                      disabled={conflict.userSkipped}
                      onChange={(merged, {fullyResolved}) => {
                        if (!fullyResolved) {
                          if (choice || selected.mergedContent) {
                            onChoice(selected.relativePath, '', '')
                          }
                          return
                        }
                        if (textA === '' && textB === '') return
                        const norm = normalizeText(merged)
                        if (norm === normalizeText(textA)) {
                          onChoice(selected.relativePath, 'keep_a', '')
                        } else if (norm === normalizeText(textB)) {
                          onChoice(selected.relativePath, 'keep_b', '')
                        } else {
                          onChoice(selected.relativePath, 'manual', merged)
                        }
                      }}
                    />
                  ) : null}
                </>
              ) : null}

              {/* 二进制文件双版本选择卡片 */}
              {needsChoice && !selected.isText ? (
                <div className="binary-choice-container">
                  <div className="binary-choice-banner">
                    <IconAlertTriangle size={18} className="banner-icon" />
                    <div className="banner-text">
                      <span className="banner-title">二进制文件不支持行级合并</span>
                      <span className="banner-sub">请选择最终整理时要保留的具体版本：</span>
                    </div>
                  </div>

                  <div className="binary-cards-list">
                    {/* 卡片 A */}
                    <div
                      className={`binary-version-card side-a ${
                        choice === 'keep_a' ? 'is-selected' : ''
                      } ${conflict.userSkipped ? 'is-disabled' : ''}`}
                      onClick={() => {
                        if (!conflict.userSkipped) {
                          onChoice(selected.relativePath, 'keep_a', '')
                        }
                      }}
                    >
                      <div className="card-top">
                        <span className="side-badge badge-a">侧 A · 源仓目标</span>
                        {choice === 'keep_a' ? (
                          <span className="selected-indicator">
                            <IconCheck size={14} /> 已选中
                          </span>
                        ) : null}
                      </div>
                      <div className="card-main">
                        <div className="card-icon-area" aria-hidden="true">
                          <IconFileBinary size={24} />
                        </div>
                        <div className="card-info">
                          <div className="card-name mono">{selected.relativePath}</div>
                          <div className="card-path mono" title={conflict.sideA}>
                            <span className="path-label">来源目录：</span>
                            <span className="path-text">{conflict.sideA}</span>
                          </div>
                        </div>
                        <div className="card-footer">
                          <button
                            type="button"
                            className={`btn ${choice === 'keep_a' ? 'btn-primary' : ''}`}
                            disabled={conflict.userSkipped}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (!conflict.userSkipped) {
                                onChoice(selected.relativePath, 'keep_a', '')
                              }
                            }}
                          >
                            {choice === 'keep_a' ? '保留侧 A（当前选择）' : '选择保留侧 A（源仓版）'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 卡片 B */}
                    <div
                      className={`binary-version-card side-b ${
                        choice === 'keep_b' ? 'is-selected' : ''
                      } ${conflict.userSkipped ? 'is-disabled' : ''}`}
                      onClick={() => {
                        if (!conflict.userSkipped) {
                          onChoice(selected.relativePath, 'keep_b', '')
                        }
                      }}
                    >
                      <div className="card-top">
                        <span className="side-badge badge-b">侧 B · 待迁入来源</span>
                        {choice === 'keep_b' ? (
                          <span className="selected-indicator">
                            <IconCheck size={14} /> 已选中
                          </span>
                        ) : null}
                      </div>
                      <div className="card-main">
                        <div className="card-icon-area" aria-hidden="true">
                          <IconFileBinary size={24} />
                        </div>
                        <div className="card-info">
                          <div className="card-name mono">{selected.relativePath}</div>
                          <div className="card-path mono" title={conflict.sideB}>
                            <span className="path-label">来源目录：</span>
                            <span className="path-text">{conflict.sideB}</span>
                          </div>
                        </div>
                        <div className="card-footer">
                          <button
                            type="button"
                            className={`btn ${choice === 'keep_b' ? 'btn-primary' : ''}`}
                            disabled={conflict.userSkipped}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (!conflict.userSkipped) {
                                onChoice(selected.relativePath, 'keep_b', '')
                              }
                            }}
                          >
                            {choice === 'keep_b' ? '保留侧 B（当前选择）' : '选择保留侧 B（待迁入版）'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* 无需手动处理的文件说明卡片 */}
              {!needsChoice ? (
                <div className="conflict-notice-pane">
                  {selected.status === 'both_same' ? (
                    <div className="notice-card notice-same">
                      <div className="notice-icon-wrap" aria-hidden="true">
                        <IconCheckCircle2 size={32} />
                      </div>
                      <h4 className="notice-title">两侧文件内容完全相同</h4>
                      <p className="notice-desc">
                        源仓目标与待迁入来源在此文件的字节内容完全一致，整理时无需任何手动合并抉择，系统将自动保留源仓既有文件。
                      </p>
                    </div>
                  ) : selected.status === 'only_a' ? (
                    <div className="notice-card notice-only-a">
                      <div className="notice-icon-wrap" aria-hidden="true">
                        <IconFile size={32} />
                      </div>
                      <h4 className="notice-title">仅存在于源仓目标 (侧 A)</h4>
                      <p className="notice-desc">
                        待迁入来源未包含此文件，系统在整理时将默认保留源仓侧的原有文件，不产生内容覆盖。
                      </p>
                    </div>
                  ) : selected.status === 'only_b' ? (
                    <div className="notice-card notice-only-b">
                      <div className="notice-icon-wrap" aria-hidden="true">
                        <IconFolderPlus size={32} />
                      </div>
                      <h4 className="notice-title">仅存在于待迁入侧 (侧 B)</h4>
                      <p className="notice-desc">
                        源仓中尚无此文件，整理时将默认作为新增文件自动归入源仓，无需额外合并。
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ReportPanel({
  report,
  onCopy,
  copiedId,
}: {
  report: OrganizeReport
  onCopy: (text: string, id: string) => void
  copiedId: string | null
}) {
  const [filterTone, setFilterTone] = useState<'all' | 'ok' | 'muted' | 'danger'>('all')
  const [search, setSearch] = useState('')

  const ok = report.succeeded?.length ?? 0
  const skip = report.skipped?.length ?? 0
  const fail = report.failed?.length ?? 0

  const filterItems = (items: {skillId: string; message: string}[]) => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (item) =>
        item.skillId.toLowerCase().includes(q) ||
        (item.message && item.message.toLowerCase().includes(q)),
    )
  }

  return (
    <div className="report-panel">
      <div className="report-stats">
        <div
          className={`report-stat-card stat-ok ${filterTone === 'ok' ? 'is-active' : ''}`}
          onClick={() => setFilterTone((curr) => (curr === 'ok' ? 'all' : 'ok'))}
          style={{cursor: 'pointer'}}
        >
          <span className="stat-label">成功完成</span>
          <span className="stat-value">{ok}</span>
        </div>
        <div
          className={`report-stat-card stat-muted ${
            filterTone === 'muted' ? 'is-active' : ''
          }`}
          onClick={() => setFilterTone((curr) => (curr === 'muted' ? 'all' : 'muted'))}
          style={{cursor: 'pointer'}}
        >
          <span className="stat-label">跳过</span>
          <span className="stat-value">{skip}</span>
        </div>
        <div
          className={`report-stat-card stat-danger ${
            filterTone === 'danger' ? 'is-active' : ''
          }`}
          onClick={() => setFilterTone((curr) => (curr === 'danger' ? 'all' : 'danger'))}
          style={{cursor: 'pointer'}}
        >
          <span className="stat-label">失败</span>
          <span className="stat-value">{fail}</span>
        </div>
      </div>

      <div className="report-filter-bar">
        <div className="organize-segmented-tabs">
          <button
            type="button"
            className={`organize-filter-tab ${filterTone === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilterTone('all')}
          >
            全部 ({ok + skip + fail})
          </button>
          <button
            type="button"
            className={`organize-filter-tab ${filterTone === 'ok' ? 'is-active' : ''}`}
            onClick={() => setFilterTone('ok')}
          >
            成功 ({ok})
          </button>
          <button
            type="button"
            className={`organize-filter-tab ${filterTone === 'muted' ? 'is-active' : ''}`}
            onClick={() => setFilterTone('muted')}
          >
            跳过 ({skip})
          </button>
          <button
            type="button"
            className={`organize-filter-tab ${filterTone === 'danger' ? 'is-active' : ''}`}
            onClick={() => setFilterTone('danger')}
          >
            失败 ({fail})
          </button>
        </div>

        <input
          type="search"
          className="report-search-input"
          placeholder="搜索报告技能 ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {(filterTone === 'all' || filterTone === 'ok') && ok > 0 ? (
        <ReportList
          title="成功完成"
          items={filterItems(report.succeeded ?? [])}
          tone="ok"
          onCopy={onCopy}
          copiedId={copiedId}
        />
      ) : null}

      {(filterTone === 'all' || filterTone === 'muted') && skip > 0 ? (
        <ReportList
          title="已跳过"
          items={filterItems(report.skipped ?? [])}
          tone="muted"
          defaultCollapsed={filterTone === 'all'}
          onCopy={onCopy}
          copiedId={copiedId}
        />
      ) : null}

      {(filterTone === 'all' || filterTone === 'danger') && fail > 0 ? (
        <ReportList
          title="执行失败"
          items={filterItems(report.failed ?? [])}
          tone="danger"
          onCopy={onCopy}
          copiedId={copiedId}
        />
      ) : null}
    </div>
  )
}

function ReportList({
  title,
  items,
  tone,
  defaultCollapsed,
  onCopy,
  copiedId,
}: {
  title: string
  items: {skillId: string; message: string}[]
  tone: 'ok' | 'muted' | 'danger'
  defaultCollapsed?: boolean
  onCopy: (text: string, id: string) => void
  copiedId: string | null
}) {
  const [collapsed, setCollapsed] = useState(
    () => defaultCollapsed ?? items.length === 0,
  )
  return (
    <div className={`report-block report-${tone}${collapsed ? ' is-collapsed' : ''}`}>
      <button
        type="button"
        className="report-block-header"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="report-block-chevron" aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
        <span className="report-block-dot" />
        <span>
          {title}（{items.length}）
        </span>
      </button>
      {collapsed ? null : items.length === 0 ? (
        <p className="muted report-empty">无匹配项</p>
      ) : (
        <ul className="report-list">
          {items.map((item, i) => (
            <li key={`${item.skillId}-${i}`} className="report-item">
              <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                <span className="mono report-skill-id">{item.skillId}</span>
                <button
                  type="button"
                  className="organize-copy-btn"
                  title="复制技能 ID"
                  onClick={() => onCopy(item.skillId, `rep-${tone}-${i}`)}
                >
                  {copiedId === `rep-${tone}-${i}` ? (
                    <IconCheck size={12} style={{color: '#15803d'}} />
                  ) : (
                    <IconCopy size={12} />
                  )}
                </button>
              </div>
              {item.message ? (
                <span className="report-item-msg">{item.message}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
