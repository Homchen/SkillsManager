import {describe, expect, it} from 'vitest'
import {groupDisplayName} from '../types'
import {
  batchGroupOverlap,
  countBatchMoves,
  countSkillsByGroup,
  filterGroupsByQuery,
  formatAssignDelta,
} from './assignGroup'

const groups = [{id: 'default'}, {id: '办公'}, {id: '开发实用SKILL'}, {id: 'brooks'}]

describe('filterGroupsByQuery', () => {
  it('returns all groups when query is blank', () => {
    expect(filterGroupsByQuery(groups, '  ', groupDisplayName)).toEqual(groups)
  })

  it('matches display name and raw id', () => {
    expect(filterGroupsByQuery(groups, '默认', groupDisplayName).map((g) => g.id)).toEqual([
      'default',
    ])
    expect(filterGroupsByQuery(groups, 'brook', groupDisplayName).map((g) => g.id)).toEqual([
      'brooks',
    ])
  })
})

describe('countSkillsByGroup', () => {
  it('counts missing group as default', () => {
    expect(
      countSkillsByGroup([
        {group: '办公'},
        {group: '办公'},
        {},
        {group: 'default'},
      ]),
    ).toEqual({办公: 2, default: 2})
  })
})

describe('countBatchMoves', () => {
  it('splits selected skills into move vs already-there', () => {
    expect(
      countBatchMoves(
        ['a', 'b', 'missing'],
        [
          {id: 'a', group: '办公'},
          {id: 'b', group: 'brooks'},
        ],
        '办公',
      ),
    ).toEqual({move: 1, skip: 1})
  })
})

describe('batchGroupOverlap', () => {
  const skills = [
    {id: 'a', group: '办公'},
    {id: 'b', group: '办公'},
    {id: 'c', group: 'brooks'},
  ]

  it('reports all / some / none', () => {
    expect(batchGroupOverlap(['a', 'b'], skills, '办公')).toBe('all')
    expect(batchGroupOverlap(['a', 'c'], skills, '办公')).toBe('some')
    expect(batchGroupOverlap(['a', 'b'], skills, 'brooks')).toBe('none')
  })
})

describe('formatAssignDelta', () => {
  it('describes a single-skill move', () => {
    expect(
      formatAssignDelta({
        batch: false,
        fromId: '开发实用SKILL',
        toId: '办公',
        displayName: groupDisplayName,
      }),
    ).toBe('将从「开发实用SKILL」移到「办公」')
  })

  it('says already there when unchanged', () => {
    expect(
      formatAssignDelta({
        batch: false,
        fromId: 'default',
        toId: 'default',
        displayName: groupDisplayName,
      }),
    ).toBe('已在「默认」')
  })

  it('summarizes batch moves', () => {
    expect(
      formatAssignDelta({
        batch: true,
        fromId: 'default',
        toId: '办公',
        moveCount: 5,
        displayName: groupDisplayName,
      }),
    ).toBe('将移动 5 个技能到「办公」')
    expect(
      formatAssignDelta({
        batch: true,
        fromId: 'default',
        toId: '办公',
        moveCount: 0,
        displayName: groupDisplayName,
      }),
    ).toBe('所选技能已在「办公」')
  })
})
