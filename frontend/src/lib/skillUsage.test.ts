import {describe, expect, it} from 'vitest'
import {
  aggregateDaily,
  buildSmoothPath,
  calculateUsageMetrics,
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

  it('calculates usage metrics correctly', () => {
    const skills = [
      item({
        id: 'skill-1',
        name: 'Skill One',
        count: 50,
        daily: {'2026-07-26': 10, '2026-07-27': 20, '2026-07-28': 5},
      }),
      item({
        id: 'skill-2',
        name: 'Skill Two',
        count: 15,
        daily: {'2026-07-27': 5},
      }),
      item({
        id: 'skill-3',
        name: 'Skill Three',
        count: 0,
        daily: {},
      }),
    ]

    const metrics = calculateUsageMetrics(skills, 7, today)
    expect(metrics.totalInRange).toBe(40) // 10 + 20 + 5 + 5
    expect(metrics.totalAllTime).toBe(65) // 50 + 15 + 0
    expect(metrics.activeSkillsCount).toBe(2)
    expect(metrics.totalSkillsCount).toBe(3)
    expect(metrics.topSkill?.item.id).toBe('skill-1')
    expect(metrics.topSkill?.score).toBe(35)
    expect(metrics.peakDay?.date).toBe('2026-07-27')
    expect(metrics.peakDay?.count).toBe(25) // 20 + 5
    expect(metrics.dailyAverage).toBe(5.7) // 40 / 7 = 5.714...
  })

  it('builds smooth bezier path', () => {
    const coords = [
      {x: 10, y: 100},
      {x: 50, y: 50},
      {x: 100, y: 80},
    ]
    const path = buildSmoothPath(coords)
    expect(path.startsWith('M10.0 100.0')).toBe(true)
    expect(path.includes('C')).toBe(true)
  })
})
