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
import {normalizeText} from '../lib/lineDiff'
import {
  conflictFileProgress,
  conflictRoundNeedsApply,
  conflictSkillNeedsAttention,
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

const ACTION_LABELS: Record<string, string> = {
  skip: '跳过',
  move_to_hub: '迁入源仓',
  replace_with_symlink: '替换为链接',
  merge_conflict: '合并冲突',
  fix_link: '修复断链',
  skipped_by_user: '用户跳过',
}

const FILE_STATUS_LABELS: Record<string, string> = {
  only_a: '仅侧 A',
  only_b: '仅侧 B',
  both_same: '两侧相同',
  both_diff: '两侧不同',
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
  const [status, setStatus] = useState('')
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

  useEffect(() => {
    const list = plan?.conflicts ?? []
    if (list.length === 0) return
    if (list.every((c) => !conflictSkillNeedsAttention(c))) {
      setStatus((prev) => (prev.startsWith('还有') ? '' : prev))
    }
  }, [plan])

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
    setStatus('')
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
      setStatus(`已生成预览：${(next.actions ?? []).length} 项动作，${conflicts.length} 项冲突`)
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

  /** 仅切换给定下标（用于搜索过滤后的全选，不影响未展示项） */
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
      setStatus(`已跳过冲突技能：${skillId}`)
    } catch (e) {
      setDialogError(errMsg(e))
    }
  }

  async function handleReset(skillId: string) {
    setDialogError('')
    try {
      const next = await ResetConflict(skillId)
      applyPlan(next)
      setStatus(`已撤销选择：${skillId}`)
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
    setStatus('')
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
      setStatus('整理执行完成')
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
      const skipped = result.skipped?.length ?? 0
      const failed = result.failed?.length ?? 0
      setStatus(`工作目录：添加 ${added} · 建链 ${linked} · 跳过 ${skipped} · 失败 ${failed}`)
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
    setStatus('')
    try {
      const extras = await DeepScanSkills()
      setStatus(`深度扫描完成，发现 ${(extras ?? []).length} 个额外技能；请重新生成预览`)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setDeepScanning(false)
      setDeepProgress('')
    }
  }

  function handleCancelDeepScan() {
    void CancelDeepScan()
    setStatus('已请求取消深度扫描…')
  }

  function closeRestoreDialog() {
    setRestoreDialogOpen(false)
    setRestoreDialogError('')
    setRestoringOrphans(false)
  }

  async function handleScanRestoreOrphans() {
    setError('')
    setStatus('')
    setRestoreDialogError('')
    if (restoreItems.length > 0) {
      setRestoreDialogOpen(true)
      return
    }
    const items = await refreshRestoreOrphanDetection()
    if (items.length === 0) {
      setStatus('未发现可恢复的误迁符号链接')
      setRestoreDialogOpen(false)
    } else {
      setRestoreDialogOpen(true)
      setStatus(`发现 ${items.length} 个可恢复的误迁链接`)
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
      setStatus(`误迁恢复：成功 ${ok} · 失败 ${failed.length}`)
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
      setStatus(`已应用合并轮次：${skillId}`)
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
    const needs = (plan?.conflicts ?? []).filter(conflictSkillNeedsAttention)
    if (needs.length > 0) {
      setStatus(`还有 ${needs.length} 个技能的冲突待处理`)
    } else {
      // 已全部决议时清掉灰色状态行，避免与蓝色 info-banner 矛盾
      setStatus('')
    }
  }

  const conflicts = plan?.conflicts ?? []
  const actions = plan?.actions ?? []
  const actionSections = useMemo(() => groupActionsByType(actions), [actions])
  const filteredActionSections = useMemo(
    () => filterActionSectionsByQuery(actionSections, actionQuery),
    [actionSections, actionQuery],
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
  const attentionConflictCount = conflicts.filter(conflictSkillNeedsAttention).length
  const allConflictsDecided =
    conflicts.length > 0 && attentionConflictCount === 0

  return (
    <div className="organize-page">
      <div className="page-toolbar">
        <button type="button" className="btn" onClick={onBack}>
          返回
        </button>
        <h2 className="page-title">一键整理</h2>
        <button
          type="button"
          className="btn btn-primary"
          disabled={loadingPreview}
          onClick={() => void handlePreview()}
        >
          {loadingPreview ? '生成中…' : '生成预览'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={deepScanning}
          onClick={() => void handleDeepScan()}
        >
          {deepScanning ? '扫描中…' : '深度扫描'}
        </button>
        {deepScanning ? (
          <button type="button" className="btn" onClick={handleCancelDeepScan}>
            取消扫描
          </button>
        ) : null}
        {restoreOrphansAvailable ? (
          <button
            type="button"
            className="btn"
            disabled={restoreScanning || restoringOrphans || deepScanning}
            onClick={() => void handleScanRestoreOrphans()}
          >
            {restoreScanning ? '扫描误迁…' : '恢复误迁链接'}
          </button>
        ) : null}
        {conflicts.length > 0 ? (
          <button type="button" className="btn" onClick={() => openConflictDialog()}>
            {allConflictsDecided
              ? `查看冲突（已全部决议）`
              : `处理冲突（待处理 ${attentionConflictCount}/${conflicts.length}）`}
          </button>
        ) : null}
        {report ? (
          <button type="button" className="btn" onClick={() => setReportOpen(true)}>
            查看执行报告
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!plan || !canExecute || executing || loadingPreview}
          onClick={() => void handleExecute()}
        >
          {executing ? '执行中…' : '开始执行'}
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {status ? <p className="muted status-line">{status}</p> : null}
      {deepScanning && deepProgress ? (
        <p className="muted status-line mono">扫描中：{deepProgress}</p>
      ) : null}
      {restoreScanning && restoreProgress ? (
        <p className="muted status-line mono">扫描误迁：{restoreProgress}</p>
      ) : null}
      {plan && canExecute && allConflictsDecided ? (
        <div className="info-banner">
          冲突已全部决议，请点击「开始执行」写入源仓并建链接（列表里仍会暂时显示「合并冲突」）。
        </div>
      ) : null}
      {plan && !canExecute && blockReason ? (
        <div className="warn-banner">
          {blockReason}
          {conflicts.length > 0 ? (
            <>
              {' '}
              <button type="button" className="link-btn" onClick={() => openConflictDialog()}>
                打开冲突处理
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {!plan ? (
        <div className="empty-state">点击「生成预览」查看整理计划。</div>
      ) : (
        <section className="panel">
          <div className="section-head">
            <h3>{report ? '执行计划（执行后重新扫描）' : '执行计划'}</h3>
            {selectionAll.toggleableCount > 0 ? (
              <label className="organize-select-all">
                <input
                  type="checkbox"
                  checked={selectionAll.checked}
                  disabled={executing || visibleSelectableIndices.length === 0}
                  ref={(el) => {
                    if (el) el.indeterminate = selectionAll.indeterminate
                  }}
                  onChange={(e) =>
                    void handleToggleIndices(visibleSelectableIndices, e.target.checked)
                  }
                  aria-label={actionQuery.trim() ? '全选当前搜索结果' : '全选可执行动作'}
                />
                全选
                <span className="muted">
                  （{selectionAll.selectedCount}/{selectionAll.toggleableCount}）
                </span>
              </label>
            ) : null}
          </div>
          <div className="organize-plan-search">
            <input
              type="search"
              placeholder="搜索技能 ID 或来源路径…"
              value={actionQuery}
              onChange={(e) => setActionQuery(e.target.value)}
              aria-label="搜索执行计划"
            />
          </div>
          {report ? (
            <p className="muted">
              这是执行完成后的最新预览，不是刚才那次执行的明细。已整理好的技能会显示为「跳过」。成功/失败详见
              <button type="button" className="link-btn" onClick={() => setReportOpen(true)}>
                执行报告
              </button>
              。
            </p>
          ) : null}
          {actions.length === 0 ? (
            <p className="muted">暂无动作</p>
          ) : filteredActionSections.length === 0 ? (
            <p className="muted">无匹配结果</p>
          ) : (
            <div className="organize-action-groups skill-groups">
              {filteredActionSections.map((sec) => {
                const collapsed = collapsedActionTypes.has(sec.type)
                const label = ACTION_LABELS[sec.type] ?? sec.type
                const sectionSelection = organizeSelectionState(
                  sec.items.map(({action}) => action),
                )
                return (
                  <section className="skill-group-section" key={sec.type}>
                    <button
                      type="button"
                      className="skill-group-header organize-action-group-header"
                      aria-expanded={!collapsed}
                      onClick={() => toggleActionGroupCollapse(sec.type)}
                    >
                      <span className="organize-action-group-chevron" aria-hidden="true">
                        {collapsed ? '▸' : '▾'}
                      </span>
                      <span className="organize-action-group-title">
                        {label}
                        <span className="muted organize-action-group-count">
                          （{sec.items.length}）
                        </span>
                      </span>
                    </button>
                    {collapsed ? null : (
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>
                                {sectionSelection.toggleableCount > 0 ? (
                                  <label className="organize-select-all organize-select-all-th">
                                    <input
                                      type="checkbox"
                                      checked={sectionSelection.checked}
                                      disabled={executing}
                                      ref={(el) => {
                                        if (el) el.indeterminate = sectionSelection.indeterminate
                                      }}
                                      onChange={(e) =>
                                        void handleToggleIndices(
                                          sec.items
                                            .filter(({action}) =>
                                              isOrganizeActionSelectable(action.type),
                                            )
                                            .map(({index}) => index),
                                          e.target.checked,
                                        )
                                      }
                                      aria-label={
                                        actionQuery.trim()
                                          ? `全选当前搜索结果中的${label}`
                                          : `全选${label}`
                                      }
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    选中
                                  </label>
                                ) : (
                                  '选中'
                                )}
                              </th>
                              <th>技能 ID</th>
                              <th>来源路径</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sec.items.map(({action, index}) => {
                              const conflict =
                                action.type === 'merge_conflict'
                                  ? conflicts.find((x) => x.skillId === action.skillId)
                                  : undefined
                              const conflictDecided =
                                Boolean(conflict) && !conflictSkillNeedsAttention(conflict!)
                              return (
                                <tr key={`${action.skillId}-${index}`}>
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(action.selected)}
                                      disabled={
                                        !isOrganizeActionSelectable(action.type) || executing
                                      }
                                      onChange={(e) =>
                                        void handleToggleSelected(index, e.target.checked)
                                      }
                                      aria-label={`选中 ${action.skillId}`}
                                    />
                                  </td>
                                  <td>
                                    <span className="mono">{action.skillId}</span>
                                    {action.type === 'merge_conflict' ? (
                                      <>
                                        {conflictDecided ? (
                                          <span className="muted"> · 已决议</span>
                                        ) : null}
                                        <button
                                          type="button"
                                          className="link-btn"
                                          onClick={() => openConflictDialog(action.skillId)}
                                        >
                                          {conflictDecided ? '查看' : '处理'}
                                        </button>
                                      </>
                                    ) : null}
                                  </td>
                                  <td className="mono muted">
                                    {(action.sources ?? []).join('; ') || '—'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          )}
        </section>
      )}

      {reportOpen && report ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog dialog-report"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-conflict-head">
              <h2 id="report-dialog-title">执行报告</h2>
              <button type="button" className="btn" onClick={() => setReportOpen(false)}>
                关闭
              </button>
            </div>
            <div className="report-dialog-body">
              <ReportPanel report={report} />
            </div>
          </div>
        </div>
      ) : null}

      {workdirDialogOpen && workdirSuggestions.length > 0 ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog dialog-workdir-suggest"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workdir-suggest-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-conflict-head">
              <h2 id="workdir-suggest-title">是否将这些外部目录添加为工作目录？</h2>
              <button type="button" className="btn" onClick={closeWorkdirDialog}>
                跳过
              </button>
            </div>
            <p className="muted workdir-suggest-desc">
              添加后将参与扫描；并为本次迁入的 skill 建立指向源仓的符号链接。
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
                跳过
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={confirmingWorkdirs || workdirSelected.size === 0}
                onClick={() => void handleConfirmAddWorkdirs()}
              >
                {confirmingWorkdirs ? '添加中…' : '添加所选'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
              <h2 id="restore-orphan-title">恢复误迁的符号链接？</h2>
              <button type="button" className="btn" onClick={closeRestoreDialog}>
                关闭
              </button>
            </div>
            <p className="muted workdir-suggest-desc">
              这些路径当前是指向源仓的符号链接（多半是深度扫描整理时误建的）。恢复后会删除链接，并把源仓中的真实目录移回原位置。
            </p>
            {restoreDialogError ? <div className="dialog-error">{restoreDialogError}</div> : null}
            <div className="page-toolbar compact">
              <button
                type="button"
                className="btn"
                onClick={() => setRestoreSelected(new Set(restoreItems.map((i) => i.linkPath)))}
              >
                全选
              </button>
              <button type="button" className="btn" onClick={() => setRestoreSelected(new Set())}>
                取消全选
              </button>
            </div>
            <ul className="workdir-suggest-list">
              {restoreItems.map((item) => (
                <li key={item.linkPath}>
                  <label className="workdir-suggest-item">
                    <input
                      type="checkbox"
                      checked={restoreSelected.has(item.linkPath)}
                      onChange={() => toggleRestoreSelected(item.linkPath)}
                    />
                    <span className="workdir-suggest-text">
                      <span className="mono path-line">{item.skillId}</span>
                      <span className="mono path-line muted">{item.linkPath}</span>
                      <span className="mono path-line muted">← {item.targetPath}</span>
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
                {restoringOrphans ? '恢复中…' : '恢复所选'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {conflictOpen && conflicts.length > 0 ? (
        <div
          className="dialog-backdrop"
          role="presentation"
        >
          <div
            className="dialog dialog-conflict"
            role="dialog"
            aria-modal="true"
            aria-labelledby="conflict-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-conflict-head">
              <h2 id="conflict-dialog-title">冲突合并</h2>
              <button type="button" className="btn" onClick={closeConflictDialog}>
                关闭
              </button>
            </div>

            {dialogError ? <div className="dialog-error">{dialogError}</div> : null}

            <div className="conflict-tabs">
              {conflicts.map((c) => {
                const {resolved, total} = conflictFileProgress(c)
                const label =
                  total > 0 ? `${c.skillId}（冲突 ${resolved}/${total}）` : c.skillId
                return (
                  <button
                    key={c.skillId}
                    type="button"
                    className={
                      activeConflict?.skillId === c.skillId
                        ? 'btn conflict-tab active'
                        : 'btn conflict-tab'
                    }
                    onClick={() => {
                      setActiveConflictId(c.skillId)
                      setDialogError('')
                    }}
                  >
                    {label}
                    {c.userSkipped ? ' · 已跳过' : ''}
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
              <button type="button" className="btn btn-primary" onClick={closeConflictDialog}>
                关闭
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
    files.find((f) => f.status === 'both_diff')?.relativePath ?? files[0]?.relativePath ?? ''
  const [selectedRel, setSelectedRel] = useState(firstDiff)
  const [textA, setTextA] = useState('')
  const [textB, setTextB] = useState('')
  // 初始 true，避免首帧用空 textA/textB 挂载 ThreeWayMerge 并误自动决议
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
    // sideA/sideB/index：应用本轮后路径会变，必须重读；不能只靠 skillId+相对路径
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
      <div className="conflict-meta">
        <div>
          <div className="muted">侧 A</div>
          <div className="mono path-line">{conflict.sideA}</div>
        </div>
        <div>
          <div className="muted">侧 B</div>
          <div className="mono path-line">{conflict.sideB}</div>
        </div>
        {conflict.total > 1 ? (
          <div className="badge">
            合并轮次 {conflict.index || 1}/{conflict.total}
          </div>
        ) : null}
        {conflict.userSkipped ? <div className="badge status-conflict">已跳过</div> : null}
      </div>

      <div className="page-toolbar compact">
        <button type="button" className="btn" onClick={onSkip}>
          跳过该 skill
        </button>
        <button type="button" className="btn" onClick={onReset}>
          撤销选择
        </button>
        {canApplyRound ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={applyingRound}
            onClick={onApplyRound}
          >
            {applyingRound ? '应用中…' : '应用本轮合并'}
          </button>
        ) : null}
      </div>

      <div className="conflict-layout">
        <div className="conflict-file-list">
          <div className="muted conflict-list-title">文件列表</div>
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
                    <span className={isDiff ? 'conflict-file-status' : 'conflict-file-status is-quiet'}>
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
                <div className="mono">{selected.relativePath}</div>
                <div className="muted">
                  {FILE_STATUS_LABELS[selected.status] ?? selected.status}
                  {selected.isText ? '' : ' · 非文本'}
                </div>
              </div>

              {needsChoice && selected.isText ? (
                <>
                  {textError ? <div className="dialog-error">{textError}</div> : null}
                  {loadingTexts ? <p className="muted">加载对比内容…</p> : null}
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
                              ? (selected.mergedContent ?? '')
                              : ''
                      }
                      disabled={conflict.userSkipped}
                      onChange={(merged, {fullyResolved}) => {
                        // 未解决完全部冲突块：清除文件决议与草稿，避免切回时用残缺文本错误还原
                        if (!fullyResolved) {
                          if (choice || selected.mergedContent) {
                            onChoice(selected.relativePath, '', '')
                          }
                          return
                        }
                        // 文本尚未加载完成时的空对比，禁止写成 keep_a
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
                <div className="choice-bar">
                  <span className="muted">二进制文件：</span>
                  <label>
                    <input
                      type="radio"
                      name={`choice-${conflict.skillId}-${selected.relativePath}`}
                      checked={choice === 'keep_a'}
                      disabled={conflict.userSkipped}
                      onChange={() => onChoice(selected.relativePath, 'keep_a', '')}
                    />
                    保留 A
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`choice-${conflict.skillId}-${selected.relativePath}`}
                      checked={choice === 'keep_b'}
                      disabled={conflict.userSkipped}
                      onChange={() => onChoice(selected.relativePath, 'keep_b', '')}
                    />
                    保留 B
                  </label>
                </div>
              ) : null}

              {!needsChoice ? (
                <p className="muted">
                  {selected.status === 'only_a'
                    ? '默认保留 A，无需选择'
                    : selected.status === 'only_b'
                      ? '默认保留 B，无需选择'
                      : '两侧相同，无需选择'}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ReportPanel({report}: {report: OrganizeReport}) {
  const ok = report.succeeded?.length ?? 0
  const skip = report.skipped?.length ?? 0
  const fail = report.failed?.length ?? 0
  return (
    <div className="report-panel">
      <div className="report-stats">
        <div className="report-stat-card stat-ok">
          <span className="stat-label">成功</span>
          <span className="stat-value">{ok}</span>
        </div>
        <div className="report-stat-card stat-muted">
          <span className="stat-label">跳过</span>
          <span className="stat-value">{skip}</span>
        </div>
        <div className="report-stat-card stat-danger">
          <span className="stat-label">失败</span>
          <span className="stat-value">{fail}</span>
        </div>
      </div>
      <ReportList title="成功" items={report.succeeded ?? []} tone="ok" />
      <ReportList
        title="跳过"
        items={report.skipped ?? []}
        tone="muted"
        defaultCollapsed
      />
      <ReportList title="失败" items={report.failed ?? []} tone="danger" />
    </div>
  )
}

function ReportList({
  title,
  items,
  tone,
  defaultCollapsed,
}: {
  title: string
  items: {skillId: string; message: string}[]
  tone: 'ok' | 'muted' | 'danger'
  /** 未传时：有条目则展开，数量为 0 则折叠 */
  defaultCollapsed?: boolean
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
        {title}（{items.length}）
      </button>
      {collapsed ? null : items.length === 0 ? (
        <p className="muted report-empty">无</p>
      ) : (
        <ul className="report-list">
          {items.map((item, i) => (
            <li key={`${item.skillId}-${i}`} className="report-item">
              <span className="mono report-skill-id">{item.skillId}</span>
              {item.message ? <span className="report-item-msg">{item.message}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
