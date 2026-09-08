import {describe, expect, it} from 'vitest'
import {computeSelectAlignment, getNextSelectIndex} from './selectHelpers'

describe('getNextSelectIndex', () => {
  const options = [
    {disabled: false},
    {disabled: true},
    {disabled: false},
    {disabled: true},
    {disabled: false},
  ]

  it('navigates to next enabled option, skipping disabled ones', () => {
    expect(getNextSelectIndex(0, options, 'next')).toBe(2)
    expect(getNextSelectIndex(2, options, 'next')).toBe(4)
    // At the end, stays at current
    expect(getNextSelectIndex(4, options, 'next')).toBe(4)
  })

  it('navigates to prev enabled option, skipping disabled ones', () => {
    expect(getNextSelectIndex(4, options, 'prev')).toBe(2)
    expect(getNextSelectIndex(2, options, 'prev')).toBe(0)
    // At the beginning, stays at current
    expect(getNextSelectIndex(0, options, 'prev')).toBe(0)
  })

  it('finds the first enabled option', () => {
    expect(getNextSelectIndex(-1, options, 'first')).toBe(0)

    const firstDisabled = [{disabled: true}, {disabled: false}]
    expect(getNextSelectIndex(-1, firstDisabled, 'first')).toBe(1)
  })

  it('finds the last enabled option', () => {
    expect(getNextSelectIndex(-1, options, 'last')).toBe(4)

    const lastDisabled = [{disabled: false}, {disabled: true}]
    expect(getNextSelectIndex(-1, lastDisabled, 'last')).toBe(0)
  })

  it('handles empty options list gracefully', () => {
    expect(getNextSelectIndex(-1, [], 'first')).toBe(-1)
    expect(getNextSelectIndex(-1, [], 'last')).toBe(-1)
    expect(getNextSelectIndex(0, [], 'next')).toBe(-1)
    expect(getNextSelectIndex(0, [], 'prev')).toBe(-1)
  })

  it('handles all options disabled', () => {
    const allDisabled = [{disabled: true}, {disabled: true}]
    expect(getNextSelectIndex(-1, allDisabled, 'first')).toBe(-1)
    expect(getNextSelectIndex(-1, allDisabled, 'last')).toBe(-1)
    expect(getNextSelectIndex(0, allDisabled, 'next')).toBe(0)
  })
})

describe('computeSelectAlignment', () => {
  it('returns left alignment when there is sufficient space on the right', () => {
    const rect = {left: 100, right: 250}
    const windowWidth = 1200
    expect(computeSelectAlignment(rect, windowWidth, 200)).toBe('left')
  })

  it('returns right alignment when space on the right is constrained', () => {
    const rect = {left: 1100, right: 1190}
    const windowWidth = 1200
    expect(computeSelectAlignment(rect, windowWidth, 200)).toBe('right')
  })

  it('falls back to left if window itself is very narrow', () => {
    const rect = {left: 50, right: 120}
    const windowWidth = 150
    expect(computeSelectAlignment(rect, windowWidth, 200)).toBe('left')
  })
})
