import type {SkillUsageItem} from '../types'

export type UsageRange = 7 | 30 | 90 | 'all'
export type RankMode = 'range' | 'total'

export function localDateKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function rangeStartKey(range: UsageRange, today = new Date()): string | null {
  if (range === 'all') return null
  return localDateKey(addDays(today, -(range - 1)))
}

export function countInRange(item: SkillUsageItem, range: UsageRange, today = new Date()): number {
  if (range === 'all') {
    return item.count ?? 0
  }
  const start = rangeStartKey(range, today)
  if (!start) return item.count ?? 0
  let total = 0
  for (const [day, n] of Object.entries(item.daily ?? {})) {
    if (day >= start && day <= localDateKey(today)) {
      total += n
    }
  }
  return total
}

export function buildDaySeries(
  daily: Record<string, number> | undefined,
  range: UsageRange,
  today = new Date(),
): {date: string; count: number}[] {
  const map = daily ?? {}
  if (range === 'all') {
    const keys = Object.keys(map).sort()
    if (keys.length === 0) {
      return [{date: localDateKey(today), count: 0}]
    }
    const start = new Date(`${keys[0]}T00:00:00`)
    const end = today
    const out: {date: string; count: number}[] = []
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const key = localDateKey(d)
      out.push({date: key, count: map[key] ?? 0})
    }
    return out
  }

  const out: {date: string; count: number}[] = []
  for (let i = range - 1; i >= 0; i--) {
    const key = localDateKey(addDays(today, -i))
    out.push({date: key, count: map[key] ?? 0})
  }
  return out
}

export function aggregateDaily(
  skills: SkillUsageItem[],
  range: UsageRange,
  today = new Date(),
): {date: string; count: number}[] {
  const merged: Record<string, number> = {}
  for (const skill of skills) {
    for (const [day, n] of Object.entries(skill.daily ?? {})) {
      merged[day] = (merged[day] ?? 0) + n
    }
  }
  return buildDaySeries(merged, range, today)
}

export function rankSkills(
  skills: SkillUsageItem[],
  mode: RankMode,
  range: UsageRange,
  today = new Date(),
): {item: SkillUsageItem; score: number}[] {
  const ranked = skills.map((item) => ({
    item,
    score: mode === 'total' ? item.count ?? 0 : countInRange(item, range, today),
  }))
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const aTime = a.item.lastUsedAt ?? ''
    const bTime = b.item.lastUsedAt ?? ''
    if (bTime !== aTime) return bTime.localeCompare(aTime)
    return a.item.id.localeCompare(b.item.id)
  })
  return ranked
}

export function formatLastUsed(iso?: string): string {
  if (!iso) return '从未使用'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '从未使用'
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  if (diffMs < 0) {
    return date.toLocaleString('zh-CN', {hour12: false})
  }
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function formatUsageLabel(count: number, lastUsedAt?: string): string {
  const n = Number.isFinite(count) ? count : 0
  if (n <= 0) return '从未使用'
  return `使用 ${n} 次 · ${formatLastUsed(lastUsedAt)}`
}
