import {describe, expect, it} from 'vitest'
import {
  SKILL_GRID_GAP,
  SKILL_GRID_MIN_COL,
  columnCount,
  columnWidth,
  hitIndicesInBox,
  rowStride,
  visibleIndexRange,
} from './skillGridWindow'

describe('columnCount', () => {
  it('returns 1 for empty or invalid width', () => {
    expect(columnCount(0)).toBe(1)
    expect(columnCount(-10)).toBe(1)
    expect(columnCount(Number.NaN)).toBe(1)
  })

  it('matches auto-fill minmax(290px, 1fr) with 16px gap', () => {
    expect(columnCount(SKILL_GRID_MIN_COL)).toBe(1)
    expect(columnCount(SKILL_GRID_MIN_COL * 2 + SKILL_GRID_GAP - 1)).toBe(1)
    expect(columnCount(SKILL_GRID_MIN_COL * 2 + SKILL_GRID_GAP)).toBe(2)
    expect(columnCount(SKILL_GRID_MIN_COL * 3 + SKILL_GRID_GAP * 2)).toBe(3)
  })
})

describe('rowStride', () => {
  it('adds the grid gap to the card height', () => {
    expect(rowStride(180)).toBe(180 + SKILL_GRID_GAP)
  })

  it('falls back when height is missing', () => {
    expect(rowStride(0)).toBe(180 + SKILL_GRID_GAP)
  })
})

describe('visibleIndexRange', () => {
  const base = {
    itemCount: 100,
    columns: 4,
    rowStride: 200,
    scrollTop: 0,
    viewportHeight: 800,
    gridOffsetTop: 0,
    overscanRows: 0,
  }

  it('returns an empty range when there are no items', () => {
    expect(visibleIndexRange({...base, itemCount: 0})).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    })
  })

  it('windows the first viewport without overscan', () => {
    const got = visibleIndexRange(base)
    // viewport 800 / stride 200 = rows 0..4 inclusive if last pixel maps to row 4
    expect(got.start).toBe(0)
    expect(got.end).toBe((Math.floor(800 / 200) + 1) * 4)
    expect(got.padTop).toBe(0)
    expect(got.padBottom).toBeGreaterThan(0)
  })

  it('shifts after scrolling', () => {
    const got = visibleIndexRange({...base, scrollTop: 400, overscanRows: 0})
    expect(got.start).toBe(2 * 4)
    expect(got.padTop).toBe(400)
  })

  it('accounts for gridOffsetTop so a grid below the fold starts at 0', () => {
    const got = visibleIndexRange({
      ...base,
      scrollTop: 0,
      gridOffsetTop: 2000,
      overscanRows: 0,
    })
    expect(got.start).toBe(0)
    expect(got.padTop).toBe(0)
  })

  it('expands to cover marquee offsets', () => {
    const got = visibleIndexRange({
      ...base,
      scrollTop: 0,
      viewportHeight: 200,
      overscanRows: 0,
      coverOffsetTop: 800,
      coverOffsetBottom: 900,
    })
    expect(got.start).toBe(0)
    expect(got.end).toBeGreaterThanOrEqual(5 * 4)
  })

  it('does not pull a far row into the contiguous window', () => {
    const got = visibleIndexRange({
      ...base,
      viewportHeight: 200,
      overscanRows: 0,
    })
    expect(got.start).toBe(0)
    expect(got.end).toBe(8)
    expect(got.padBottom).toBeGreaterThan(0)
  })

  it('applies overscan around the viewport', () => {
    const none = visibleIndexRange({...base, scrollTop: 400, overscanRows: 0})
    const extra = visibleIndexRange({...base, scrollTop: 400, overscanRows: 1})
    expect(extra.start).toBeLessThan(none.start)
    expect(extra.end).toBeGreaterThan(none.end)
  })
})

describe('hitIndicesInBox', () => {
  const gridWidth = SKILL_GRID_MIN_COL * 4 + SKILL_GRID_GAP * 3
  const layout = {
    itemCount: 12,
    columns: 4,
    rowStride: 200,
    cardHeight: 180,
    gridWidth,
    originLeft: 0,
    originTop: 0,
  }

  it('returns nothing for an empty grid', () => {
    expect(
      hitIndicesInBox({
        ...layout,
        itemCount: 0,
        box: {left: 0, top: 0, right: 100, bottom: 100},
      }),
    ).toEqual([])
  })

  it('hits the first card', () => {
    expect(
      hitIndicesInBox({
        ...layout,
        box: {left: 10, top: 10, right: 40, bottom: 40},
      }),
    ).toEqual([0])
  })

  it('hits a later row without requiring that card to be mounted', () => {
    expect(
      hitIndicesInBox({
        ...layout,
        box: {left: 0, top: 400, right: 40, bottom: 430},
      }),
    ).toEqual([8])
  })

  it('hits a full first row', () => {
    expect(
      hitIndicesInBox({
        ...layout,
        box: {left: 0, top: 0, right: gridWidth, bottom: 100},
      }),
    ).toEqual([0, 1, 2, 3])
  })

  it('does not hit cards in the row gap', () => {
    expect(
      hitIndicesInBox({
        ...layout,
        box: {left: 0, top: 181, right: 40, bottom: 199},
      }),
    ).toEqual([])
  })

  it('accounts for a grid origin offset', () => {
    expect(
      hitIndicesInBox({
        ...layout,
        originLeft: 100,
        originTop: 50,
        box: {left: 110, top: 60, right: 140, bottom: 90},
      }),
    ).toEqual([0])
  })

  it('skips missing cells on the last row', () => {
    const colW = columnWidth(gridWidth, 4)
    expect(
      hitIndicesInBox({
        ...layout,
        itemCount: 9,
        box: {
          left: 3 * (colW + SKILL_GRID_GAP),
          top: 400,
          right: gridWidth,
          bottom: 500,
        },
      }),
    ).toEqual([])
  })
})
