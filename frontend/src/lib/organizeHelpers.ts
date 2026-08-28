/** Minimal conflict shape used by organize gate / progress helpers. */
export type ConflictFileLike = {
  status: string
  choice?: string
  mergedContent?: string
}

export type ConflictSkillLike = {
  files?: ConflictFileLike[]
  userSkipped?: boolean
  index?: number
  total?: number
  pendingSources?: string[]
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function normalizeCanExecute(result: unknown): {ok: boolean; reason: string} {
  if (result && typeof result === 'object') {
    const r = result as {ok?: boolean; reason?: string}
    if (typeof r.ok === 'boolean') {
      return {ok: r.ok, reason: r.reason ?? ''}
    }
  }
  // 兼容旧绑定误把三返回值丢成裸 boolean 的情况
  if (typeof result === 'boolean') {
    return {
      ok: result,
      reason: result ? '' : '无法确认整理门禁状态，请重新生成预览或重启应用',
    }
  }
  return {ok: false, reason: '无法确认整理门禁状态，请重新生成预览'}
}

/** 需用户决议的 both_diff 文件：已解决数 / 总数（仅 A/仅 B/两侧相同不计入） */
export function conflictFileProgress(c: ConflictSkillLike): {resolved: number; total: number} {
  const diffs = (c.files ?? []).filter((f) => f.status === 'both_diff')
  let resolved = 0
  for (const f of diffs) {
    if (f.choice === 'keep_a' || f.choice === 'keep_b') resolved++
    else if (f.choice === 'manual' && f.mergedContent) resolved++
  }
  return {resolved, total: diffs.length}
}

/** 本轮文件是否都已决议（跳过的 skill 视为无需处理） */
export function conflictFilesReady(c: ConflictSkillLike): boolean {
  if (c.userSkipped) return true
  const {resolved, total} = conflictFileProgress(c)
  return total === 0 || resolved >= total
}

/** 仍需用户继续处理的冲突 skill（未决议文件，或待「应用本轮合并」） */
export function conflictSkillNeedsAttention(c: ConflictSkillLike): boolean {
  if (c.userSkipped) return false
  if (!conflictFilesReady(c)) return true
  return Boolean(
    (c.total ?? 0) > 0 && ((c.index ?? 0) < (c.total ?? 0) || (c.pendingSources?.length ?? 0) > 0),
  )
}

/** 本轮 both_diff 已全部决议且仍有后续轮次待应用 */
export function conflictRoundNeedsApply(c: ConflictSkillLike | null): boolean {
  if (!c || c.userSkipped) return false
  if (!((c.total ?? 0) > 0 && ((c.index ?? 0) < (c.total ?? 0) || (c.pendingSources?.length ?? 0) > 0))) {
    return false
  }
  const files = c.files ?? []
  return files.every((f) => {
    if (f.status !== 'both_diff') return true
    if (f.choice === 'keep_a' || f.choice === 'keep_b') return true
    if (f.choice === 'manual') return Boolean(f.mergedContent)
    return false
  })
}

/** 执行计划分组展示顺序：需处理的在前，「跳过」置底 */
export const ORGANIZE_ACTION_TYPE_ORDER = [
  'move_to_hub',
  'replace_with_symlink',
  'merge_conflict',
  'fix_link',
  'skipped_by_user',
  'skip',
] as const

export type IndexedOrganizeAction<T> = {action: T; index: number}

export type OrganizeActionTypeSection<T> = {
  type: string
  items: IndexedOrganizeAction<T>[]
}

/** skip / 用户跳过不可勾选；其余动作可切换 Selected */
export function isOrganizeActionSelectable(type: string): boolean {
  return type !== 'skip' && type !== 'skipped_by_user'
}

export type OrganizeSelectionState = {
  toggleableCount: number
  selectedCount: number
  checked: boolean
  indeterminate: boolean
}

/** 汇总可勾选动作的选中态（供全选框 checked / indeterminate） */
export function organizeSelectionState(
  actions: ReadonlyArray<{type: string; selected?: boolean}>,
): OrganizeSelectionState {
  let toggleableCount = 0
  let selectedCount = 0
  for (const a of actions) {
    if (!isOrganizeActionSelectable(a.type)) continue
    toggleableCount++
    if (a.selected) selectedCount++
  }
  return {
    toggleableCount,
    selectedCount,
    checked: toggleableCount > 0 && selectedCount === toggleableCount,
    indeterminate: selectedCount > 0 && selectedCount < toggleableCount,
  }
}

/** 按动作类型分组，保留原始下标供勾选更新 */
export function groupActionsByType<T extends {type: string}>(
  actions: T[],
): OrganizeActionTypeSection<T>[] {
  const map = new Map<string, IndexedOrganizeAction<T>[]>()
  actions.forEach((action, index) => {
    const type = action.type || 'unknown'
    const list = map.get(type)
    if (list) list.push({action, index})
    else map.set(type, [{action, index}])
  })
  const known = new Set<string>(ORGANIZE_ACTION_TYPE_ORDER)
  const sections: OrganizeActionTypeSection<T>[] = []
  for (const type of ORGANIZE_ACTION_TYPE_ORDER) {
    const items = map.get(type)
    if (items?.length) sections.push({type, items})
  }
  for (const type of [...map.keys()].filter((t) => !known.has(t)).sort()) {
    sections.push({type, items: map.get(type)!})
  }
  return sections
}

export type OrganizeActionSearchable = {
  skillId?: string
  sources?: string[]
}

/** 按技能 ID 或来源路径匹配执行计划搜索词 */
export function matchesOrganizeActionSearch(
  action: OrganizeActionSearchable,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if ((action.skillId ?? '').toLowerCase().includes(q)) return true
  return (action.sources ?? []).some((src) => src.toLowerCase().includes(q))
}

/** 过滤分组后的执行计划；保留原始下标供勾选更新 */
export function filterActionSectionsByQuery<T extends OrganizeActionSearchable & {type: string}>(
  sections: OrganizeActionTypeSection<T>[],
  query: string,
): OrganizeActionTypeSection<T>[] {
  const q = query.trim()
  if (!q) return sections
  const out: OrganizeActionTypeSection<T>[] = []
  for (const sec of sections) {
    const items = sec.items.filter(({action}) => matchesOrganizeActionSearch(action, q))
    if (items.length > 0) out.push({type: sec.type, items})
  }
  return out
}
