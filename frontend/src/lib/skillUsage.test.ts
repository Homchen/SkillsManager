import {describe, expect, it} from 'vitest'
import {
  aggregateDaily,
  countInRange,
  formatUsageLabel,
  localDateKey,
  rankSkills,
} from './skillUsage'
import type {SkillUsageItem} from '../types'

const today = new Date('2026-07-28T12:00:00')

function item(partial: Partial<SkillUsageItem> & {id: string}): SkillUsageItem {
  return {
    name: partial.name ?? partial.id,
    count: partial.count ?? 0,
    lastUsedAt: partial.lastUsedAt,
    daily: partial.daily ?? {},
    id: partial.id,
  }
}

describe('skillUsage helpers', () => {
  it('counts within selected day range', () => {
    const skill = item({
      id: 'a',
      count: 10,
      daily: {
        '2026-07-20': 2,
        '2026-07-27': 3,
        '2026-07-28': 4,
      },
    })
    expect(countInRange(skill, 7, today)).toBe(7)
    expect(countInRange(skill, 30, today)).toBe(9)
    expect(countInRange(skill, 'all', today)).toBe(10)
  })

  it('ranks by range score then last used', () => {
    const ranked = rankSkills(
      [
        item({id: 'b', count: 5, daily: {'2026-07-28': 1}, lastUsedAt: '2026-07-28T09:00:00Z'}),
        item({id: 'a', count: 9, daily: {'2026-07-28': 5}, lastUsedAt: '2026-07-28T08:00:00Z'}),
        item({id: 'c', count: 0}),
      ],
      'range',
      30,
      today,
    )
    expect(ranked.map((r) => r.item.id)).toEqual(['a', 'b', 'c'])
    expect(ranked[0].score).toBe(5)
  })

  it('aggregates overall daily series', () => {
    const points = aggregateDaily(
      [
        item({id: 'a', daily: {'2026-07-27': 1, '2026-07-28': 2}}),
        item({id: 'b', daily: {'2026-07-28': 3}}),
      ],
      7,
      today,
    )
    expect(points[points.length - 2]).toEqual({date: '2026-07-27', count: 1})
    expect(points[points.length - 1]).toEqual({date: '2026-07-28', count: 5})
  })

  it('formats unused skills', () => {
    expect(formatUsageLabel(0)).toBe('从未使用')
    expect(localDateKey(today)).toBe('2026-07-28')
  })
})
