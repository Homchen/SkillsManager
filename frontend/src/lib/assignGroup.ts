import {DEFAULT_GROUP_ID} from '../types'

export type GroupOverlap = 'all' | 'some' | 'none'

export function filterGroupsByQuery<T extends {id: string}>(
  groups: T[],
  query: string,
  displayName: (id: string) => string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  return groups.filter((g) => {
    const name = displayName(g.id).toLowerCase()
    return name.includes(q) || g.id.toLowerCase().includes(q)
  })
}

export function countSkillsByGroup(skills: Array<{group?: string}>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const skill of skills) {
    const id = skill.group || DEFAULT_GROUP_ID
    counts[id] = (counts[id] || 0) + 1
  }
  return counts
}

export function countBatchMoves(
  selectedIds: Iterable<string>,
  skills: Array<{id: string; group?: string}>,
  targetGroup: string,
): {move: number; skip: number} {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  let move = 0
  let skip = 0
  for (const id of selectedIds) {
    const skill = byId.get(id)
    if (!skill) continue
    const current = skill.group || DEFAULT_GROUP_ID
    if (current === targetGroup) skip++
    else move++
  }
  return {move, skip}
}

export function batchGroupOverlap(
  selectedIds: Iterable<string>,
  skills: Array<{id: string; group?: string}>,
  groupId: string,
): GroupOverlap {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  let matched = 0
  let seen = 0
  for (const id of selectedIds) {
    const skill = byId.get(id)
    if (!skill) continue
    seen++
    if ((skill.group || DEFAULT_GROUP_ID) === groupId) matched++
  }
  if (seen === 0 || matched === 0) return 'none'
  if (matched === seen) return 'all'
  return 'some'
}

export function formatAssignDelta(opts: {
  batch: boolean
  fromId: string
  toId: string
  moveCount?: number
  displayName: (id: string) => string
}): string {
  const to = opts.displayName(opts.toId)
  if (opts.batch) {
    const n = opts.moveCount ?? 0
    if (n === 0) return `所选技能已在「${to}」`
    return `将移动 ${n} 个技能到「${to}」`
  }
  const from = opts.displayName(opts.fromId)
  if (opts.fromId === opts.toId) return `已在「${from}」`
  return `将从「${from}」移到「${to}」`
}
