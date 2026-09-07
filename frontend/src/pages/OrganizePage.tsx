import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
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
  IconCheck,
  IconChevron,
  IconCopy,
  IconFolderPlus,
  IconFolderSync,
  IconLink,
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
  conflictRoundNeedsApply,
  conflictSkillNeedsAttention,
  detectToolFromPath,
  errMsg,
  filterActionSectionsByQuery,
  groupActionsByType,
  isOrganizeActionSelectable,
  normalizeCanExecute,
  organizeSelectionState,
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
  const [blockReason, setBlockReason] = useState('')
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
  const [applyingRound, setApplyingRound] = useState(false)
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
      setBlockReason('请先生成整理预览')
      return
    }
    try {
      const result = await CanExecuteOrganize()
      const {ok, reason} = normalizeCanExecute(result)
      setCanExecute(ok)
      setBlockReason(ok ? '' : reason || '当前无法执行整理')
    } catch (e) {
      setCanExecute(false)
      setBlockReason(errMsg(e))
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

  async function handlePreview() {
    const seq = ++previewSeqRef.current
    setLoadingPreview(true)
    setError('')
    setReport(null)
    setReportOpen(false)
    setDialogError('')
    setActionQuery('')
    try {
      const next = await PreviewOrganize()
      if (seq !== previewSeqRef.current) return
      const conflicts = next.conflicts ?? []
      resetActionGroupCollapse()
      applyPlan(next, {clearReport: true, openConflict: conflicts.length > 0})
      setActiveConflictId(conflicts[0]?.skillId ?? null)
      showToast({
        message: `整理预览就绪：${(next.actions ?? []).length} 项动作${conflicts.length ? `，${conflicts.length} 项冲突` : ''}`,
        tone: 'success',
      })
    } catch (e) {
      if (seq !== previewSeqRef.current) return
      setError(errMsg(e))
    } finally {
      if (seq === previewSeqRef.current) setLoadingPreview(false)
    }
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
      const gate = normalizeCanExecute(await CanExecuteOrganize())
      if (!gate.ok) {
        setCanExecute(false)
        setBlockReason(gate.reason || '当前无法执行整理')
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
        const next = await PreviewOrganize()
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
    setError('')
    try {
      const extras = await DeepScanSkills()
      showToast({
        message: `深度扫描完成，发现 ${(extras ?? []).length} 个额外技能，请重新生成预览`,
        tone: 'info',
      })
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setDeepScanning(false)
      setDeepProgress('')
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

        <div className="organize-header-right">
          {restoreOrphansAvailable ? (
            <button
              type="button"
              className="btn"
              disabled={restoreScanning || restoringOrphans || deepScanning}
              onClick={() => void handleScanRestoreOrphans()}
              title="恢复误建的指向源仓的符号链接"
            >
              <IconRotateCcw size={15} />
              <span>{restoreScanning ? '扫描中…' : '恢复误迁链接'}</span>
            </button>
          ) : null}

          {report ? (
            <button
              type="button"
              className="btn"
              onClick={() => setReportOpen(true)}
              title="查看最近一次整理的执行报告"
            >
              <IconActivity size={15} />
              <span>执行报告</span>
            </button>
          ) : null}

          <button
            type="button"
            className="btn"
            disabled={deepScanning}
            onClick={() => (deepScanning ? handleCancelDeepScan() : void handleDeepScan())}
            title="深度扫描整个磁盘或工作区查找未登记的技能"
          >
            <IconSearch size={15} />
            <span>{deepScanning ? '取消扫描' : '深度扫描'}</span>
          </button>

          {plan ? (
            <button
              type="button"
              className="btn"
              disabled={loadingPreview || executing}
              onClick={() => void handlePreview()}
              title="重新扫描各工具目录生成最新预览"
            >
              <IconRefresh size={15} className={loadingPreview ? 'is-spinning' : ''} />
              <span>重新预览</span>
            </button>
          ) : null}

          {plan && attentionConflictCount > 0 ? (
            <button
              type="button"
              className="btn btn-attention"
              onClick={() => openConflictDialog()}
              title="存在同名内容冲突，必须先决议才能执行整理"
            >
              <IconAlertTriangle size={15} />
              <span>解决冲突 ({attentionConflictCount})</span>
            </button>
          ) : null}

          <button
            type="button"
            className="btn btn-primary btn-execute"
            data-tour={!plan ? 'demo-preview' : 'demo-execute'}
            disabled={!plan ? loadingPreview : !canExecute || executing || loadingPreview}
            onClick={() => (!plan ? void handlePreview() : void handleExecute())}
          >
            {!plan ? (
              <>
                <IconFolderSync size={16} className={loadingPreview ? 'is-spinning' : ''} />
                <span>{loadingPreview ? '正在扫描…' : '生成整理预览'}</span>
              </>
            ) : executing ? (
              <>
                <IconRefresh size={16} className="is-spinning" />
                <span>正在执行…</span>
              </>
            ) : (
              <>
                <IconCheck size={16} />
                <span>开始执行整理</span>
              </>
            )}
          </button>
        </div>
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
                  ? loadingPreview
                    ? '正在扫描所有工具目录…'
                    : '检测散落技能与失效链接'
                  : `已发现 ${actions.length} 项动作，${conflicts.length} 处冲突`
              }
            >
              {!plan
                ? loadingPreview
                  ? '正在扫描所有工具目录…'
                  : '检测散落技能与失效链接'
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

      {deepScanning && deepProgress ? (
        <div className="organize-progress-banner">
          <div className="organize-progress-text">
            <IconSearch size={16} className="is-spinning" />
            <span>深度扫描进行中：</span>
            <span className="mono">{deepProgress}</span>
          </div>
          <button type="button" className="btn btn-sm" onClick={handleCancelDeepScan}>
            取消扫描
          </button>
        </div>
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
            冲突已全部决议完成！请点击右上角「开始执行整理」完成向源仓迁入并挂载符号链接。
          </span>
        </div>
      ) : null}

      {plan && !canExecute && blockReason ? (
        <div className="warn-banner">
          <span>{blockReason}</span>
          {conflicts.length > 0 ? (
            <button
              type="button"
              className="link-btn"
              onClick={() => openConflictDialog()}
              style={{marginLeft: 8, fontWeight: 600}}
            >
              立即打开冲突处理
            </button>
          ) : null}
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
            <button
              type="button"
              className="btn btn-primary btn-hero-primary"
              disabled={loadingPreview}
              onClick={() => void handlePreview()}
            >
              <IconFolderSync size={16} className={loadingPreview ? 'is-spinning' : ''} />
              <span>{loadingPreview ? '正在扫描生成中…' : '立即开始扫描并生成预览'}</span>
            </button>
            <button
              type="button"
              className="btn"
              disabled={deepScanning}
              onClick={() => void handleDeepScan()}
            >
              <IconSearch size={16} />
              <span>全盘深度扫描</span>
            </button>
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
                          <thead>
                            <tr>
                              <th style={{width: 48, textAlign: 'center'}}>选中</th>
                              <th style={{minWidth: 200}}>技能名称 / ID</th>
                              <th style={{width: 140}}>动作类型</th>
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
                                    <div className="organize-skill-cell">
                                      <span className="organize-skill-id-chip">
                                        {action.skillId}
                                      </span>
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
                                    </div>
                                  </td>

                                  <td>
                                    <span
                                      className={`organize-action-pill ${config.toneClass}`}
                                    >
                                      <ActionIcon size={13} />
                                      <span>{config.label}</span>
                                    </span>
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
                                              <span
                                                className="organize-source-path"
                                                title={src}
                                              >
                                                {src}
                                              </span>
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
            className="dialog dialog-conflict"
            role="dialog"
            aria-modal="true"
            aria-labelledby="conflict-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-conflict-head">
              <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                <IconAlertTriangle size={18} style={{color: '#d97706'}} />
                <h2 id="conflict-dialog-title">冲突合并工作台</h2>
              </div>
              <button type="button" className="btn" onClick={closeConflictDialog}>
                关闭
              </button>
            </div>

            {dialogError ? <div className="dialog-error">{dialogError}</div> : null}

            {/* 冲突技能切换选项卡 */}
            <div className="conflict-tabs-scroll conflict-tabs">
              {conflicts.map((c) => {
                const {resolved, total} = conflictFileProgress(c)
                const isDecided = resolved >= total && total > 0
                return (
                  <button
                    key={c.skillId}
                    type="button"
                    className={`conflict-tab-item conflict-tab ${
                      activeConflict?.skillId === c.skillId ? 'is-active active' : ''
                    }`}
                    onClick={() => {
                      setActiveConflictId(c.skillId)
                      setDialogError('')
                    }}
                  >
                    <span>{c.skillId}</span>
                    {total > 0 ? (
                      <span
                        className={`organize-tab-count ${
                          isDecided ? '' : 'is-attention'
                        }`}
                      >
                        {resolved}/{total}
                      </span>
                    ) : null}
                    {c.userSkipped ? (
                      <span className="muted">· 已跳过</span>
                    ) : isDecided ? (
                      <span style={{color: '#15803d'}}>✓</span>
                    ) : null}
                  </button>
                )
              })}
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

            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={closeConflictDialog}
              >
                完成并返回列表
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
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

  const choice = selected?.choice ?? ''
  const needsChoice = selected?.status === 'both_diff'

  return (
    <div className="conflict-panel">
      {/* 来源对比元数据卡片 */}
      <div className="conflict-side-cards">
        <div className="conflict-side-card">
          <span className="conflict-side-title">侧 A（源仓目标）</span>
          <span className="mono path-line" title={conflict.sideA}>
            {conflict.sideA}
          </span>
        </div>
        <div className="conflict-side-card">
          <span className="conflict-side-title">侧 B（待迁入来源）</span>
          <span className="mono path-line" title={conflict.sideB}>
            {conflict.sideB}
          </span>
        </div>
      </div>

      <div
        className="page-toolbar compact"
        style={{justifyContent: 'space-between', marginBottom: 10}}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          {conflict.total > 1 ? (
            <span className="organize-action-pill type-replace_with_symlink">
              合并轮次 {conflict.index || 1} / {conflict.total}
            </span>
          ) : null}
          {conflict.userSkipped ? (
            <span className="organize-action-pill type-skip">已手动跳过</span>
          ) : null}
        </div>

        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <button type="button" className="btn btn-sm" onClick={onSkip}>
            跳过该技能
          </button>
          <button type="button" className="btn btn-sm" onClick={onReset}>
            重置当前决议
          </button>
          {canApplyRound ? (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={applyingRound}
              onClick={onApplyRound}
            >
              {applyingRound ? '应用中…' : '应用本轮合并（进入下一轮）'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="conflict-layout">
        <div className="conflict-file-list">
          <div className="muted conflict-list-title">文件清单 ({files.length})</div>
          <ul>
            {files.map((file) => {
              const active = file.relativePath === selected?.relativePath
              const isDiff = file.status === 'both_diff'
              return (
                <li key={file.relativePath}>
                  <button
                    type="button"
                    className={conflictFileItemClass(active, file)}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => setSelectedRel(file.relativePath)}
                  >
                    <span className="conflict-file-row">
                      <span className="conflict-file-mark" aria-hidden="true" />
                      <span className="mono">{file.relativePath}</span>
                    </span>
                    <span
                      className={
                        isDiff
                          ? 'conflict-file-status'
                          : 'conflict-file-status is-quiet'
                      }
                    >
                      {FILE_STATUS_LABELS[file.status] ?? file.status}
                      {conflictFileChoiceSuffix(file)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="conflict-detail">
          {!selected ? (
            <p className="muted">暂无冲突文件</p>
          ) : (
            <>
              <div className="conflict-detail-head">
                <span className="mono" style={{fontWeight: 700}}>
                  {selected.relativePath}
                </span>
                <span className="muted" style={{fontSize: 12}}>
                  {FILE_STATUS_LABELS[selected.status] ?? selected.status}
                  {selected.isText ? '' : ' · 二进制文件'}
                </span>
              </div>

              {needsChoice && selected.isText ? (
                <>
                  {textError ? <div className="dialog-error">{textError}</div> : null}
                  {loadingTexts ? (
                    <div style={{padding: 24, textAlign: 'center'}} className="muted">
                      正在读取文件文本对比…
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

              {needsChoice && !selected.isText ? (
                <div className="choice-bar" style={{padding: 16}}>
                  <span className="muted">二进制文件不支持行级合并，请选择保留版本：</span>
                  <label>
                    <input
                      type="radio"
                      name={`choice-${conflict.skillId}-${selected.relativePath}`}
                      checked={choice === 'keep_a'}
                      disabled={conflict.userSkipped}
                      onChange={() => onChoice(selected.relativePath, 'keep_a', '')}
                    />
                    <span>保留侧 A（源仓版）</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`choice-${conflict.skillId}-${selected.relativePath}`}
                      checked={choice === 'keep_b'}
                      disabled={conflict.userSkipped}
                      onChange={() => onChoice(selected.relativePath, 'keep_b', '')}
                    />
                    <span>保留侧 B（待迁入版）</span>
                  </label>
                </div>
              ) : null}

              {!needsChoice ? (
                <div style={{padding: '24px 16px'}} className="muted">
                  {selected.status === 'only_a'
                    ? '该文件仅存在于源仓侧，将默认保留，无需选择。'
                    : selected.status === 'only_b'
                      ? '该文件仅存在于待迁入侧，将默认保留并归入源仓，无需选择。'
                      : '两侧文件内容完全相同，无需手动合并。'}
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
